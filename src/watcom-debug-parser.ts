import { BufferPtr } from "./BufferPtr.ts";
import { parseModuleLocals } from "./watcom-debug-parser-locals.ts";
import { parseModuleTypes } from "./watcom-debug-parser-types.ts";

// Best reference I found was https://open-watcom.github.io/open-watcom-v2-wikidocs/wddoc.html

export interface MasterDebugHeader {
	signature: number[];
	exeMajorVersion: number;
	exeMinorVersion: number;
	objMajorVersion: number;
	objMinorVersion: number;
	langSize: number;
	segmentSize: number;
	debugSize: number;
}

export const masterDebugHeaderSize = 14;
export function parseMasterDebugHeader(
	buffer: ArrayBufferLike,
): MasterDebugHeader {
	const offset = buffer.byteLength - masterDebugHeaderSize;
	const ptr = BufferPtr.from(buffer, offset, masterDebugHeaderSize);

	return {
		signature: [ptr.getAndInc(), ptr.getAndInc()],
		exeMajorVersion: ptr.getAndInc(),
		exeMinorVersion: ptr.getAndInc(),
		objMajorVersion: ptr.getAndInc(),
		objMinorVersion: ptr.getAndInc(),
		langSize: ptr.getAndInc16Le(),
		segmentSize: ptr.getAndInc16Le(),
		debugSize: ptr.getAndInc32Le(),
	};
}

function parseLangs({ langSize }: MasterDebugHeader, buffer: Uint8Array) {
	const ptr = BufferPtr.from(buffer, 0, langSize);
	return ptr.getCStringArray(langSize);
}

function parseSegmentList(
	{ langSize, segmentSize }: MasterDebugHeader,
	buffer: Uint8Array,
) {
	const ptr = BufferPtr.from(buffer, langSize, segmentSize);
	return ptr.getUint16LeArray(segmentSize);
}

export interface SectionDebugHeader {
	/** phantom field with the offset of the header itself, relative to the debug region */
	offset: number;
	moduleOffset: number;
	globalOffset: number;
	addressOffset: number;
	sectionSize: number;
	sectionId: number;
}

function parseSectionDebugHeader(
	mdh: MasterDebugHeader,
	buffer: Uint8Array,
): SectionDebugHeader {
	const offset = mdh.langSize + mdh.segmentSize;
	const ptr = BufferPtr.from(buffer, offset);

	return {
		offset,
		moduleOffset: ptr.getAndInc32Le(),
		globalOffset: ptr.getAndInc32Le(),
		addressOffset: ptr.getAndInc32Le(),
		sectionSize: ptr.getAndInc32Le(),
		sectionId: ptr.getAndInc16Le(),
	};
}

export interface ModuleInfo {
	moduleIndex: number;
	language: number;
	locals_offset: number;
	locals_num_entries: number;
	types_offset: number;
	types_num_entries: number;
	lines_offset: number;
	lines_num_entries: number;
	name: string;
}

function parseModule(
	ptr: BufferPtr<Uint8Array<ArrayBufferLike>>,
	moduleIndex: number,
): ModuleInfo {
	return {
		moduleIndex,
		language: ptr.getAndInc16Le(),
		locals_offset: ptr.getAndInc32Le(),
		locals_num_entries: ptr.getAndInc16Le(),
		types_offset: ptr.getAndInc32Le(),
		types_num_entries: ptr.getAndInc16Le(),
		lines_offset: ptr.getAndInc32Le(),
		lines_num_entries: ptr.getAndInc16Le(),
		name: ptr.getPascalString(),
	};
}

function parseModules(
	_mdh: MasterDebugHeader,
	sectionHeader: SectionDebugHeader,
	buffer: Uint8Array,
) {
	const ptr = BufferPtr.fromSlice(
		buffer,
		sectionHeader.offset + sectionHeader.moduleOffset,
		sectionHeader.globalOffset,
	);
	const rt: ModuleInfo[] = [];
	let indexCounter = 0;
	while (!ptr.atEnd()) {
		rt.push(parseModule(ptr, indexCounter++));
	}

	return rt;
}

export interface DemandTableMeta {
	moduleIndex: number;
	moduleName: string;
	offset: number;
	len: number;
}

interface GlobalInfo {
	addressOffset: number;
	addressSegment: number;
	moduleIndex: number;
	kind: number;
	isStatic: boolean;
	isData: boolean;
	isCode: boolean;
	name: string;
}

function parseKind(kind: number) {
	return {
		kind,
		isStatic: Boolean(kind & 0b1),
		isData: Boolean((kind >> 1) & 0b1),
		isCode: Boolean((kind >> 2) & 0b1),
	};
}

function parseGlobalSymbolsTable(
	_mdh: MasterDebugHeader,
	sectionHeader: SectionDebugHeader,
	buffer: Uint8Array,
) {
	const ptr = BufferPtr.from(
		buffer,
		sectionHeader.offset + sectionHeader.globalOffset,
		sectionHeader.addressOffset - sectionHeader.globalOffset,
	);
	const rt: GlobalInfo[] = [];
	while (!ptr.atEnd()) {
		const globalInfo: GlobalInfo = {
			addressOffset: ptr.getAndInc32Le(),
			addressSegment: ptr.getAndInc16Le(),
			moduleIndex: ptr.getAndInc16Le(),
			...parseKind(ptr.getAndInc()),
			name: ptr.getPascalString(),
		};
		rt.push(globalInfo);
	}

	return rt;
}

interface SegmentInfo {
	address: number;
	segment: number;
	addressInfoCount: number;
	addressInfo: AddressInfo[];
}

interface AddressInfo {
	size: number;
	moduleIndex: number;
}

function parseAddressInfo(ptr: BufferPtr<Uint8Array<ArrayBufferLike>>) {
	return {
		address: 0,
		size: ptr.getAndInc32Le(),
		moduleIndex: ptr.getAndInc16Le(),
	};
}

function parseAddressesTable(
	_mdh: MasterDebugHeader,
	sectionHeader: SectionDebugHeader,
	buffer: Uint8Array,
) {
	const ptr = BufferPtr.from(
		buffer,
		sectionHeader.offset + sectionHeader.addressOffset,
		sectionHeader.sectionSize - sectionHeader.addressOffset,
	);
	const rt: SegmentInfo[] = [];
	while (!ptr.atEnd()) {
		const segmentInfo: SegmentInfo = {
			address: ptr.getAndInc32Le(),
			segment: ptr.getAndInc16Le(),
			addressInfoCount: ptr.getAndInc16Le(),
			addressInfo: [],
		};
		for (
			let i = 0, address = segmentInfo.address;
			i < segmentInfo.addressInfoCount;
			i++
		) {
			const addressInfo = parseAddressInfo(ptr);
			addressInfo.address = address;
			address += addressInfo.size;
			segmentInfo.addressInfo.push(addressInfo);
		}
		rt.push(segmentInfo);
	}

	return rt;
}

/**
 * This parses the entire debugging "region", which starts "debugSize" back from the
 * end of the file. The docs don't use the term "region", but I needed a word that wasn't
 * already used (like "section").
 */
export function parseDebuggingRegion(
	masterDebugHeader: MasterDebugHeader,
	buffer: Uint8Array,
) {
	// const ptr = new BufferPtr(buffer);

	// TODO: handle overlays
	// Right now we assume no overlays, so only one sectionDebugHeader
	const sectionDebugHeader = parseSectionDebugHeader(masterDebugHeader, buffer);
	const modules = parseModules(masterDebugHeader, sectionDebugHeader, buffer);

	const modulesLocals = modules.flatMap((m) => {
		return parseModuleLocals(masterDebugHeader, sectionDebugHeader, buffer, m);
	});

	const modulesTypes = modules.flatMap((m) => {
		return parseModuleTypes(masterDebugHeader, sectionDebugHeader, buffer, m);
	});

	const globalSymbolsTable = parseGlobalSymbolsTable(
		masterDebugHeader,
		sectionDebugHeader,
		buffer,
	);

	const addressesTable = parseAddressesTable(
		masterDebugHeader,
		sectionDebugHeader,
		buffer,
	);

	return {
		langs: parseLangs(masterDebugHeader, buffer),
		segments: parseSegmentList(masterDebugHeader, buffer),
		sectionDebugHeaders: [sectionDebugHeader],
		modules,
		modulesLocals,
		modulesTypes,
		globalSymbolsTable,
		addressesTable,
	};
}

export function parseWatcomDebugInfo(buffer: ArrayBufferLike) {
	const masterDebugHeader = parseMasterDebugHeader(buffer);
	const debuggingRegionOffset = buffer.byteLength - masterDebugHeader.debugSize;
	const debuggingRegionBuffer = new Uint8Array(
		buffer,
		debuggingRegionOffset,
		masterDebugHeader.debugSize,
	);

	const debuggingRegion = parseDebuggingRegion(
		masterDebugHeader,
		debuggingRegionBuffer,
	);

	return {
		masterDebugHeader,
		debuggingRegion,
	};
}
