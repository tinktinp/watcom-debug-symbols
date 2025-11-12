import type { BufferPtr } from "./BufferPtr";

const hexToLSM = {
	0x10: "BP_OFFSET_BYTE",
	0x11: "BP_OFFSET_WORD",
	0x12: "BP_OFFSET_DWORD",
	0x20: "CONST_ADDR286",
	0x21: "CONST_ADDR386",
	0x22: "CONST_INT_1",
	0x23: "CONST_INT_2",
	0x24: "CONST_INT_3",
	0x30: "MULTI_REG", // all 0x3x
	0x40: "REG", // all 0x4x's
	0x50: "IND_REG_CALLOC_NEAR",
	0x51: "IND_REG_CALLOC_FAR",
	0x52: "IND_REG_RALLOC_NEAR",
	0x53: "IND_REG_RALLOC_FAR",
	0x60: "OPERATOR_IND_2",
	0x61: "OPERATOR_IND_4",
	0x62: "OPERATOR_ADDRESS286",
	0x63: "OPERATOR_ADDRESS386",
	0x64: "OPERATOR_ZEB",
	0x65: "OPERATOR_ZEW",
	0x66: "OPERATOR_MK_FP",
	0x67: "OPERATOR_POP",
	0x68: "OPERATOR_XCHG",
	0x69: "OPERATOR_ADD",
	0x6a: "OPERATOR_DUP",
	0x6b: "OPERATOR_NOP",
} as const;

type HexToLSM = typeof hexToLSM;
type LSM = HexToLSM[keyof HexToLSM] | "UNKNOWN";

function getLSMNameFromHex(hex: number): LSM {
	const lookup = hexToLSM[hex];
	if (lookup) return lookup;
	if ((hex & 0xf0) === 0x30) return "MULTI_REG";
	if ((hex & 0xf0) === 0x40) return "REG";
	return "UNKNOWN";
}

const registerNumberToName = {
	0: "AL",
	1: "AH",
	2: "BL",
	3: "BH",
	4: "CL",
	5: "CH",
	6: "DL",
	7: "DH",
	8: "AX",
	9: "BX",
	10: "CX",
	11: "DX",
	12: "SI",
	13: "DI",
	14: "BP",
	15: "SP",
	16: "CS",
	17: "SS",
	18: "DS",
	19: "ES",
	20: "ST0",
	21: "ST1",
	22: "ST2",
	23: "ST3",
	24: "ST4",
	25: "ST5",
	26: "ST6",
	27: "ST7",
	28: "EAX",
	29: "EBX",
	30: "ECX",
	31: "EDX",
	32: "ESI",
	33: "EDI",
	34: "EBP",
	35: "ESP",
	36: "FS",
	37: "GS",
} as const;

type RegisterNumberToName = typeof registerNumberToName;
type RegisterName = RegisterNumberToName[keyof RegisterNumberToName];

interface LsmBase {
	lsmName: LSM;
}
interface LsmNoExtras extends LsmBase {
	lsmName:
		| "OPERATOR_IND_2"
		| "OPERATOR_IND_4"
		| "OPERATOR_ADDRESS286"
		| "OPERATOR_ADDRESS386"
		| "OPERATOR_ZEB"
		| "OPERATOR_ZEW"
		| "OPERATOR_MK_FP"
		| "OPERATOR_POP"
		| "OPERATOR_ADD"
		| "OPERATOR_DUP"
		| "OPERATOR_NOP"
		| "UNKNOWN";
}
interface LsmOffset extends LsmBase {
	lsmName: "BP_OFFSET_BYTE" | "BP_OFFSET_WORD" | "BP_OFFSET_DWORD";
	offset: number;
}
interface LsmReg extends LsmBase {
	lsmName: "REG" | "IND_REG_CALLOC_NEAR" | "IND_REG_RALLOC_NEAR";
	registerNumber: number;
	registerName: string;
}
interface LsmMultiReg extends LsmBase {
	lsmName: "MULTI_REG";
	registerNumbers: number[];
	registerNames: string[];
}
interface LsmIndRegFar extends LsmBase {
	lsmName: "IND_REG_CALLOC_FAR" | "IND_REG_RALLOC_FAR";
	registerNumber: number;
	registerName: string;
	registerNumber2: number;
	registerName2: string;
}
interface LsmAddr extends LsmBase {
	lsmName: "CONST_ADDR286";
	constAddress: number;
}
interface LsmAddr386 extends LsmBase {
	lsmName: "CONST_ADDR386";
	constAddress: number;
	constSegment: number;
}
interface LsmConstInt extends LsmBase {
	lsmName: "CONST_INT_1" | "CONST_INT_2" | "CONST_INT_3";
	constInt: number;
}

interface LsmOpXchg extends LsmBase {
	lsmName: "OPERATOR_XCHG";
	stack: number;
}

type LsmObject =
	| LsmNoExtras
	| LsmOffset
	| LsmMultiReg
	| LsmReg
	| LsmAddr
	| LsmAddr386
	| LsmConstInt
	| LsmOpXchg
	| LsmIndRegFar;

export function readAndParseLocationStackMachine(
	ptr: BufferPtr<Uint8Array<ArrayBufferLike>>,
) {
	const rv: LsmObject[] = [];
	const firstByte = ptr.get();

	let len: number;
	if (firstByte < 0x80) {
		len = 1;
	} else {
		ptr.offset++;
		len = firstByte - 0x80;
	}

	for (const startOffset = ptr.offset; ptr.offset < startOffset + len; ) {
		const byte = ptr.getAndInc();
		const lsmName = getLSMNameFromHex(byte);
		// const lsm: Partial<LsmObject> = {
		//     lsmName,
		// };
		let lsm: LsmObject;
		switch (lsmName) {
			case "BP_OFFSET_BYTE":
				lsm = {
					lsmName,
					offset: ptr.getAndIncS(),
				};
				break;
			case "BP_OFFSET_WORD":
				lsm = {
					lsmName,
					offset: ptr.getAndIncS16Le(),
				};
				break;
			case "BP_OFFSET_DWORD":
				lsm = {
					lsmName,
					offset: ptr.getAndIncS32Le(),
				};
				break;
			case "REG": {
				const registerNumber = byte & 0b1111;
				lsm = {
					lsmName,
					registerNumber: registerNumber,
					registerName: registerNumberToName[registerNumber],
				};

				break;
			}
			case "MULTI_REG": {
				const registers = 1 + (byte & 0b1111);
				const registerNumbers: number[] = [];
				const registerNames: string[] = [];
				for (let i = 0; i < registers; i++) {
					const registerNumber = ptr.getAndInc();
					registerNumbers.push(registerNumber);
					registerNames.push(registerNumberToName[registerNumber]);
				}
				lsm = {
					lsmName,
					registerNames,
					registerNumbers,
				};
				break;
			}

			case "CONST_ADDR286":
				lsm = {
					lsmName,
					constAddress: ptr.getAndInc32Le(),
				};
				break;
			case "CONST_ADDR386":
				lsm = {
					lsmName,
					constAddress: ptr.getAndInc32Le(),
					constSegment: ptr.getAndInc16Le(),
				};
				break;
			case "CONST_INT_1":
				lsm = {
					lsmName,
					constInt: ptr.getAndInc(),
				};
				break;
			case "CONST_INT_2":
				lsm = {
					lsmName,
					constInt: ptr.getAndInc16Le(),
				};
				break;
			case "CONST_INT_3":
				lsm = {
					lsmName,
					constInt: ptr.getAndInc32Le(),
				};
				break;

			case "IND_REG_CALLOC_NEAR":
			case "IND_REG_RALLOC_NEAR":
				{
					const registerNumber = ptr.getAndInc();
					lsm = {
						lsmName,
						registerNumber: registerNumber,
						registerName: registerNumberToName[registerNumber],
					};
				}
				break;

			case "IND_REG_CALLOC_FAR":
			case "IND_REG_RALLOC_FAR":
				{
					const registerNumber = ptr.getAndInc();
					const registerNumber2 = ptr.getAndInc();

					lsm = {
						lsmName,
						registerNumber: registerNumber,
						registerName: registerNumberToName[registerNumber],
						registerNumber2: registerNumber2,
						registerName2: registerNumberToName[registerNumber2],
					};
				}
				break;

			// operator
			case "OPERATOR_XCHG":
				lsm = {
					lsmName,
					stack: ptr.getAndInc(),
				};
				break;
			// other operators don't have extra fields
			default:
				lsm = {
					lsmName,
				};
		}
		rv.push(lsm);
	}

	return rv;
}
