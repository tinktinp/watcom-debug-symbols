import { BufferPtr } from "./BufferPtr.ts";
import type {
	DemandTableMeta,
	MasterDebugHeader,
	ModuleInfo,
	SectionDebugHeader,
} from "./watcom-debug-parser";
import { readAndParseLocationStackMachine } from "./watcom-debug-parser-stack-machine.ts";

const localTypeHexToName = {
	// Variables
	0x10: "MODULE",
	0x11: "LOCAL",
	0x12: "MODULE386",
	0x13: "MODULE_LOC",
	// Code
	0x20: "BLOCK",
	0x21: "NEAR_RTN",
	0x22: "FAR_RTN",
	0x23: "BLOCK_386",
	0x24: "NEAR_RTN_386",
	0x25: "FAR_RTN_386",
	0x26: "MEMBER_SCOPE",
	// New Base
	0x30: "ADD_PREV_SEG",
	0x31: "SET_BASE",
	0x32: "SET_BASE386",
} as const;

type LocalTypeHexToName = typeof localTypeHexToName;

const namelessLocals = [
	"BLOCK",
	"BLOCK_386",
	"MEMBER_SCOPE",
	"ADD_PREV_SEG",
	"SET_BASE",
	"SET_BASE386",
];

export function readIndex(ptr: BufferPtr<Uint8Array<ArrayBufferLike>>) {
	const rv = ptr.getAndInc();
	if (rv & 0b1000_0000) {
		return ptr.getAndInc() | ((rv & ~0x80) << 8);
	} else {
		return rv;
	}
}

export type LocalEntryTypeName = LocalTypeHexToName[keyof LocalTypeHexToName];

export interface LocalEntry {
	len: number;
	typeCode: number;
	typeName: LocalEntryTypeName;
}
function parseLocalEntry(buffer: ArrayBufferLike): LocalEntry {
	const ptr = BufferPtr.from(buffer);

	const len = ptr.getAndInc();
	const typeCode = ptr.getAndInc();
	const typeName: LocalEntryTypeName =
		localTypeHexToName[typeCode] || "UNKNOWN!";

	// TODO: replace this with a series of types like we did elsewhere
	const f: Record<string, any> = {};

	switch (typeName) {
		// Data
		case "MODULE":
			f.location = ptr.getAndInc32Le();
			f.typeIndex = readIndex(ptr);
			break;
		case "LOCAL":
		case "MODULE_LOC":
			f.location = readAndParseLocationStackMachine(ptr);
			f.typeIndex = readIndex(ptr);
			break;
		case "MODULE386":
			f.location = ptr.getAndInc32Le();
			f.segment = ptr.getAndInc16Le();
			f.typeIndex = readIndex(ptr);
			break;

		// Code
		case "BLOCK":
			f.startOffset = ptr.getAndInc16Le();
			f.size = ptr.getAndInc16Le();
			f.parentBlockOffset = ptr.getAndInc16Le();
			break;
		case "BLOCK_386":
			f.startOffset = ptr.getAndInc32Le();
			f.size = ptr.getAndInc32Le();
			f.parentBlockOffset = ptr.getAndInc16Le();
			break;

		case "NEAR_RTN":
		case "FAR_RTN":
			// common with block
			f.startOffset = ptr.getAndInc16Le();
			f.size = ptr.getAndInc16Le();
			f.parentBlockOffset = ptr.getAndInc16Le();
			// near_rtn specific
			f.prologueSize = ptr.getAndInc();
			f.epilogueSize = ptr.getAndInc();
			f.returnAddressOffset = ptr.getAndInc16Le();
			f.typeIndex = readIndex(ptr);
			f.returnValueLocation = readAndParseLocationStackMachine(ptr);
			f.numberOfRegisterParams = ptr.getAndInc();
			f.registerParams = [];
			for (let i = 0; i < f.numberOfRegisterParams; i++) {
				f.registerParams.push(readAndParseLocationStackMachine(ptr));
			}
			break;

		case "NEAR_RTN_386":
		case "FAR_RTN_386":
			// common with BLOCK_386
			f.startOffset = ptr.getAndInc32Le();
			f.size = ptr.getAndInc32Le();
			f.parentBlockOffset = ptr.getAndInc16Le();
			// specific to NEAR_RTN_386
			f.prologueSize = ptr.getAndInc();
			f.epilogueSize = ptr.getAndInc();
			f.returnAddressOffset = ptr.getAndInc32Le();
			f.typeIndex = readIndex(ptr);
			f.returnValueLocation = readAndParseLocationStackMachine(ptr);
			// f.returnValueLocation = ptr.getAndInc(); // TODO: parse location!
			f.numberOfRegisterParams = ptr.getAndInc();
			f.registerParams = [];
			for (let i = 0; i < f.numberOfRegisterParams; i++) {
				f.registerParams.push(readAndParseLocationStackMachine(ptr));
			}
			break;

		case "MEMBER_SCOPE":
			// this one is for C++, not used in the stuff I am interested in
			f.parentBlockOffset = ptr.getAndInc16Le();
			f.classTypeIndex = readIndex(ptr);

			break;

		// Change Base Addr
		case "ADD_PREV_SEG":
			f.segmentIncrease = ptr.getAndInc16Le();
			break;
		case "SET_BASE":
			f.location = ptr.getAndInc32Le();
			break;
		case "SET_BASE386":
			f.location = ptr.getAndInc32Le();
			f.segment = ptr.getAndInc16Le();
			break;
	}

	// this only works correctly if we parsed the right number of bytes above
	if (!namelessLocals.includes(typeName)) f.symbolName = ptr.getCString(); // It's not actually nul terminated, it just goes to the end of this entry
	return {
		len,
		typeCode,
		typeName,
		...f,
	};
}

function parseLocalEntries(
	masterDebugHeader: MasterDebugHeader,
	sectionDebugHeader: SectionDebugHeader,
	meta: DemandTableMeta,
	buffer: Uint8Array<ArrayBufferLike>,
) {
	const ptr = BufferPtr.from(
		buffer,
		sectionDebugHeader.offset + meta.offset,
		meta.len,
	);
	const rv: LocalEntry[] = [];

	while (!ptr.atEnd()) {
		const len = ptr.get();
		const entry = parseLocalEntry(ptr.getArrayBuffer(len));
		rv.push(entry);
	}

	return rv;
}

export function parseModuleLocals(
	masterDebugHeader: MasterDebugHeader,
	sectionDebugHeader: SectionDebugHeader,
	buffer: Uint8Array<ArrayBufferLike>,
	module: ModuleInfo,
) {
	if (!module.locals_num_entries) return [];

	const { moduleIndex } = module;
	const ptr = BufferPtr.from(
		buffer,
		sectionDebugHeader.offset + module.locals_offset,
		(module.locals_num_entries + 1) * 4,
	);
	// const table = new Uint32Array(
	//     buffer.buffer,
	//     buffer.byteOffset + module.locals_offset,
	//     module.locals_num_entries,
	// );
	const locals: { meta: DemandTableMeta; entries: unknown }[] = [];
	let lastIndex = 0;
	while (!ptr.atEnd()) {
		const index = ptr.getAndInc32Le();
		if (lastIndex) {
			const meta = {
				moduleIndex,
				moduleName: module.name,
				offset: lastIndex,
				len: index - lastIndex,
			};
			const entries = parseLocalEntries(
				masterDebugHeader,
				sectionDebugHeader,
				meta,
				buffer,
			);
			locals.push({ meta, entries });
		}
		lastIndex = index;
	}
	return locals;
}
