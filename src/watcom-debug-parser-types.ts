import { BufferPtr } from "./BufferPtr.ts";
import type {
	DemandTableMeta,
	MasterDebugHeader,
	ModuleInfo,
	SectionDebugHeader,
} from "./watcom-debug-parser.ts";
import { readIndex } from "./watcom-debug-parser-locals.ts";

interface BaseTypeEntry {
	selfIndex: number;
	len: number;
	typeCode: number;
	categoryName: TypeCategory;
	typeName: TypeName;
	name?: string;
	scalarType?: number;
	scalarTypeSizeInBytes?: number;
	scalarTypeClassRaw?: number;
	scalarTypeClassName?: string;
	scope?: number;
	type?: number;
	tableOffset?: number;
	highBound?: number;
	baseType?: number;
	indexType?: number;
	scalarType2?: number;
	bounds?: number;
	boundsSegment?: number;
	lowBound?: number;
	baseLocator?: string;
	numberOfFields?: number;
	value?: number;
	fields?: TypeEntry[];
	size?: number;
	offset?: number;
	startBit?: number;
	bitSize?: number;
	retType?: number;
	paramsCount?: number;
	paramTypes?: number[];
}
type TypeEntry = BaseTypeEntry;

const hexToTypeCategories = {
	0x1: "TYPE_NAME",
	0x2: "ARRAY",
	0x3: "SUBRANGE",
	0x4: "POINTER",
	0x5: "ENUMERATED",
	0x6: "STRUCTURE",
	0x7: "PROCEDURE",
	0x8: "CHARACTER_BLOCK",
} as const;
type HexToTypeCategories = typeof hexToTypeCategories;
type TypeCategory = HexToTypeCategories[keyof HexToTypeCategories];

const hexToTypeNameType = {
	0x10: "SCALAR",
	0x11: "SCOPE",
	0x12: "NAME",
	0x13: "CUE_TABLE",
	0x14: "EOF",
} as const;

type HexToTypeNameType = typeof hexToTypeNameType;
type TypeNameType = HexToTypeNameType[keyof HexToTypeNameType];

const hexToArrayTypes = {
	0x20: "ARRAY_BYTE_INDEX",
	0x21: "ARRAY_WORD_INDEX",
	0x22: "ARRAY_LONG_INDEX",
	0x23: "ARRAY_TYPE_INDEX",
	0x24: "ARRAY_DESC_INDEX",
	0x25: "ARRAY_DESC_INDEX_386",
} as const;
type HexToArrayTypes = typeof hexToArrayTypes;
type ArrayType = HexToArrayTypes[keyof HexToArrayTypes];

const hexToSubrange = {
	0x30: "SUBRANGE_BYTE_RANGE",
	0x31: "SUBRANGE_WORD_RANGE",
	0x32: "SUBRANGE_LONG_RANGE",
} as const;
type HexToSubrangeTypes = typeof hexToSubrange;
type SubrangeType = HexToSubrangeTypes[keyof HexToSubrangeTypes];

const hexToPointerType = {
	0x40: "NEAR",
	0x41: "FAR",
	0x42: "HUGE",
	0x43: "NEAR_DEREF",
	0x44: "FAR_DEREF",
	0x45: "HUGE_DEREF",
	0x46: "NEAR386",
	0x47: "FAR386",
	0x48: "NEAR386_DEREF",
	0x49: "FAR386_DEREF",
} as const;
type HexToPointerType = typeof hexToPointerType;
type PointerType = HexToPointerType[keyof HexToPointerType];

const hexToEnumType = {
	0x50: "ENUMERATED_LIST",
	0x51: "ENUMERATED_CONST_BYTE",
	0x52: "ENUMERATED_CONST_WORD",
	0x53: "ENUMERATED_CONST_LONG",
} as const;
type HexToEnumType = typeof hexToEnumType;
type EnumType = HexToEnumType[keyof HexToEnumType];

const hexToStructType = {
	0x60: "STRUCTURE_LIST",
	0x61: "STRUCTURE_FIELD_BYTE",
	0x62: "STRUCTURE_FIELD_WORD",
	0x63: "STRUCTURE_FIELD_LONG",
	0x64: "STRUCTURE_BIT_BYTE",
	0x65: "STRUCTURE_BIT_WORD",
	0x66: "STRUCTURE_BIT_LONG",
	0x67: "STRUCTURE_FIELD_CLASS",
	0x68: "STRUCTURE_BIT_CLASS",
	0x69: "STRUCTURE_INHERIT_CLASS",
} as const;
type HextToStructType = typeof hexToStructType;
type StructType = HextToStructType[keyof HextToStructType];

const hexToProcedureType = {
	0x70: "PROCEDURE_NEAR",
	0x71: "PROCEDURE_FAR",
	0x72: "PROCEDURE_NEAR386",
	0x73: "PROCEDURE_FAR386",
	0x75: "PROCEDURE_EXT_PARMS",
} as const;
type HexToProcedureType = typeof hexToProcedureType;
type ProcedureType = HexToProcedureType[keyof HexToProcedureType];
////

type TypeName =
	| TypeNameType
	| ArrayType
	| SubrangeType
	| PointerType
	| EnumType
	| StructType
	| ProcedureType;

const hexToAllTypeNames = {
	...hexToTypeNameType,
	...hexToArrayTypes,
	...hexToSubrange,
	...hexToPointerType,
	...hexToEnumType,
	...hexToStructType,
	...hexToProcedureType,
} as const;

// only `TYPE_NAME`, `STRUCTURE` and `ENUMERATED` categories have entries with `names`
const namelessTypes = [
	"EOF",
	"CUE_TABLE",
	"STRUCTURE_LIST",
	"STRUCTURE_INHERIT_CLASS",
];
const namelessCategories = [
	"ARRAY",
	"SUBRANGE",
	"POINTER",
	"PROCEDURE",
	"CHARACTER_BLOCK",
];
function hasName(category: string, typeName: string) {
	if (namelessCategories.includes(category)) return false;
	if (namelessTypes.includes(typeName)) return false;
	return true;
}

const scalarTypeClassHexToName = {
	0b000: "int",
	0b001: "unsigned",
	0b010: "float",
	0b011: "void",
	0b100: "complex",
} as const;

interface Context {
	lastEnum?: TypeEntry;
	lastStruct?: TypeEntry;
}

function parseTypeEntry(buffer: ArrayBufferLike, context: Context): TypeEntry {
	const ptr = BufferPtr.from(buffer);

	const len = ptr.getAndInc();
	const typeCode = ptr.getAndInc();
	const categoryName = hexToTypeCategories[typeCode >> 4] || "UNKNOWN";
	const typeName: TypeName = hexToAllTypeNames[typeCode] || "UNKNOWN!";

	const f: TypeEntry = {
		selfIndex: 0, // filled in later
		len,
		typeCode,
		categoryName,
		typeName,
	};

	switch (typeName) {
		// Data
		case "SCALAR":
			f.scalarType = ptr.getAndInc();
			f.scalarTypeSizeInBytes = (f.scalarType & 0b1111) + 1;
			f.scalarTypeClassRaw = (f.scalarType >> 4) & 0b111;
			f.scalarTypeClassName =
				scalarTypeClassHexToName[f.scalarTypeClassRaw] || "UNKNOWN";
			break;
		case "SCOPE":
			break;
		case "NAME":
			f.scope = readIndex(ptr);
			f.type = readIndex(ptr);
			break;
		case "CUE_TABLE":
			f.tableOffset = ptr.getAndInc32Le();
			break;
		case "EOF":
			break;
		case "ARRAY_BYTE_INDEX":
			f.highBound = ptr.getAndInc();
			f.baseType = readIndex(ptr);
			break;
		case "ARRAY_WORD_INDEX":
			f.highBound = ptr.getAndInc16Le();
			f.baseType = readIndex(ptr);
			break;
		case "ARRAY_LONG_INDEX":
			f.highBound = ptr.getAndInc32Le();
			f.baseType = readIndex(ptr);
			break;
		case "ARRAY_TYPE_INDEX":
			f.indexType = readIndex(ptr);
			f.baseType = readIndex(ptr);
			break;
		case "ARRAY_DESC_INDEX":
			f.scalarType = ptr.getAndInc();
			f.scalarType2 = ptr.getAndInc();
			f.bounds = ptr.getAndInc32Le();
			f.baseType = readIndex(ptr);
			break;
		case "ARRAY_DESC_INDEX_386":
			f.scalarType = ptr.getAndInc();
			f.scalarType2 = ptr.getAndInc();
			f.bounds = ptr.getAndInc32Le();
			f.boundsSegment = ptr.getAndInc16Le();
			f.baseType = readIndex(ptr);
			break;

		case "SUBRANGE_BYTE_RANGE":
			f.lowBound = ptr.getAndInc();
			f.highBound = ptr.getAndInc();
			f.baseType = readIndex(ptr);
			break;
		case "SUBRANGE_WORD_RANGE":
			f.lowBound = ptr.getAndInc16Le();
			f.highBound = ptr.getAndInc16Le();
			f.baseType = readIndex(ptr);
			break;
		case "SUBRANGE_LONG_RANGE":
			f.lowBound = ptr.getAndInc32Le();
			f.highBound = ptr.getAndInc32Le();
			f.baseType = readIndex(ptr);
			break;

		case "ENUMERATED_LIST":
			f.numberOfFields = ptr.getAndInc16Le();
			f.scalarType = ptr.getAndInc();
			f.fields = [];
			context.lastEnum = f;
			break;
		case "ENUMERATED_CONST_BYTE":
			f.value = ptr.getAndInc();
			context.lastEnum?.fields?.push(f);
			break;
		case "ENUMERATED_CONST_WORD":
			f.value = ptr.getAndInc16Le();
			context.lastEnum?.fields?.push(f);
			break;
		case "ENUMERATED_CONST_LONG":
			f.value = ptr.getAndInc32Le();
			context.lastEnum?.fields?.push(f);
			break;

		case "STRUCTURE_LIST":
			f.numberOfFields = ptr.getAndInc16Le();
			f.size = ptr.getAndInc32Le();
			f.fields = [];
			context.lastStruct = f;
			break;
		case "STRUCTURE_FIELD_BYTE":
			f.offset = ptr.getAndInc();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		case "STRUCTURE_FIELD_WORD":
			f.offset = ptr.getAndInc16Le();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		case "STRUCTURE_FIELD_LONG":
			f.offset = ptr.getAndInc32Le();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		case "STRUCTURE_BIT_BYTE":
			f.offset = ptr.getAndInc();
			f.startBit = ptr.getAndInc();
			f.bitSize = ptr.getAndInc();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		case "STRUCTURE_BIT_WORD":
			f.offset = ptr.getAndInc16Le();
			f.startBit = ptr.getAndInc();
			f.bitSize = ptr.getAndInc();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		case "STRUCTURE_BIT_LONG":
			f.offset = ptr.getAndInc32Le();
			f.startBit = ptr.getAndInc();
			f.bitSize = ptr.getAndInc();
			f.type = readIndex(ptr);
			context.lastStruct?.fields?.push(f);
			break;
		// TODO: FIELD_CLASS, BIT_CLASS, INHERIT_CLASS

		case "PROCEDURE_NEAR":
		case "PROCEDURE_NEAR386":
		case "PROCEDURE_FAR":
		case "PROCEDURE_FAR386":
			f.retType = readIndex(ptr);
			f.paramsCount = ptr.getAndInc();
			f.paramTypes = [];
			for (let i = 0; i < f.paramsCount; i++) {
				f.paramTypes.push(readIndex(ptr));
			}
			break;
		case "PROCEDURE_EXT_PARMS":
			f.paramTypes = [];
			while (!ptr.atEnd()) {
				f.paramTypes.push(readIndex(ptr));
			}
			break;

		default:
			if (f.categoryName === "POINTER") {
				f.baseType = readIndex(ptr);
				const baseLocator = ptr.getCString();
				if (baseLocator) f.baseLocator = baseLocator;
			}
			break;
	}

	// this only works correctly if we parsed the right number of bytes above
	if (hasName(categoryName, typeName)) f.name = ptr.getCString(); // It's not actually nul terminated, it just goes to the end of this entry
	return f;
}

const noSelfIndex = [
	"CUE_TABLE",
	"STRUCTURE_FIELD_BYTE",
	"STRUCTURE_FIELD_WORD",
	"STRUCTURE_FIELD_LONG",
	"STRUCTURE_BIT_BYTE",
	"STRUCTURE_BIT_WORD",
	"STRUCTURE_BIT_LONG",
	"STRUCTURE_FIELD_CLASS",
	"STRUCTURE_BIT_CLASS",
	"STRUCTURE_INHERIT_CLASS",
];

function parseTypeEntries(
	masterDebugHeader: MasterDebugHeader,
	sectionDebugHeader: SectionDebugHeader,
	meta: DemandTableMeta,
	buffer: Uint8Array<ArrayBufferLike>,
	startIndex: number,
) {
	const ptr = BufferPtr.from(
		buffer,
		sectionDebugHeader.offset + meta.offset,
		meta.len,
	);
	const rv: TypeEntry[] = [];
	const context: Context = {};

	while (!ptr.atEnd()) {
		const len = ptr.get();
		if (len === 0) break;
		const nextOffset = ptr.offset + len;
		// console.log('parseTypeEntries', { nextOffset, len });

		const entry = parseTypeEntry(ptr.getArrayBuffer(len), context);
		if (!noSelfIndex.includes(entry.typeName)) {
			entry.selfIndex = startIndex++;
		}
		// skip adding the noSelfIndex types to the list. Except for cue_table, add those anyway.
		if (
			!noSelfIndex.includes(entry.typeName) ||
			entry.typeName === "CUE_TABLE"
		) {
			rv.push(entry);
		}

		// if (ptr.offset < nextOffset)
		ptr.offset = nextOffset;
	}

	return rv;
}

export function parseModuleTypes(
	masterDebugHeader: MasterDebugHeader,
	sectionDebugHeader: SectionDebugHeader,
	buffer: Uint8Array<ArrayBufferLike>,
	module: ModuleInfo,
) {
	if (!module.types_num_entries) return [];

	const { moduleIndex } = module;
	const ptr = BufferPtr.from(
		buffer,
		sectionDebugHeader.offset + module.types_offset,
		(module.locals_num_entries + 1) * 4,
	);

	const types: { meta: DemandTableMeta; entries: unknown }[] = [];
	let lastIndex = 0;
	let currentTypeIndex = 1;
	while (!ptr.atEnd()) {
		const index = ptr.getAndInc32Le();
		if (lastIndex) {
			const meta = {
				moduleIndex,
				moduleName: module.name,
				offset: lastIndex,
				len: index - lastIndex,
			};
			const entries = parseTypeEntries(
				masterDebugHeader,
				sectionDebugHeader,
				meta,
				buffer,
				currentTypeIndex,
			);
			currentTypeIndex += entries.length;
			types.push({ meta, entries });
		}
		lastIndex = index;
	}
	return types;
}
