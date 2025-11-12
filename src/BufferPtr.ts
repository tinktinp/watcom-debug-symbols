interface Indexable {
	[index: number]: number;
}

const textDecoder = new TextDecoder("iso-8859-1");

export class BufferPtr<
	T extends Indexable & {
		length: number;
		fill: (value: number, start?: number, end?: number) => T;
		slice: (start?: number, end?: number) => T;
	},
> {
	buffer: T;
	offset: number;

	constructor(buffer: T, offset: number = 0) {
		this.buffer = buffer;
		this.offset = offset;
	}

	static from(b: ArrayBufferLike, byteOffset: number = 0, byteLength?: number) {
		let uint8Array: Uint8Array<ArrayBufferLike>;

		if (ArrayBuffer.isView(b)) {
			const ob = b.buffer;
			uint8Array = new Uint8Array(ob, b.byteOffset + byteOffset, byteLength);
		} else {
			uint8Array = new Uint8Array(b, byteOffset, byteLength);
		}

		return new BufferPtr(uint8Array);
	}

	static fromSlice(b: ArrayBufferLike, byteOffset: number, byteLength: number) {
		return BufferPtr.from(b, byteOffset, byteLength - byteOffset);
	}

	get() {
		return this.buffer[this.offset];
	}
	get16Le() {
		return this.buffer[this.offset] | (this.buffer[this.offset + 1] << 8);
	}
	get32Le() {
		return (
			this.buffer[this.offset] |
			(this.buffer[this.offset + 1] << 8) |
			(this.buffer[this.offset + 2] << 16) |
			(this.buffer[this.offset + 3] << 24)
		);
	}
	getAndInc() {
		return this.buffer[this.offset++];
	}
	getAndIncS() {
		const rv = this.getAndInc();
		return BufferPtr.toSigned(rv, 7);
	}
	getAndInc16Le() {
		const rv = this.get16Le();
		this.offset += 2;
		return rv;
	}

	static toSigned(input: number, bits: number) {
		const signBit = 1 << bits;
		const mask = signBit - 1;
		if (input >= signBit) {
			input = -((~input & mask) + 1);
		}
		return input;
	}
	getAndIncS16Le() {
		const rv = this.getAndInc16Le();
		return BufferPtr.toSigned(rv, 15);
	}
	getAndInc32Le() {
		const rv = this.get32Le();
		this.offset += 4;
		return rv;
	}
	getAndIncS32Le() {
		const rv = this.getAndInc32Le();
		return BufferPtr.toSigned(rv, 31);
	}
	getAndDec() {
		return this.buffer[this.offset--];
	}
	putAndInc(data: number) {
		this.buffer[this.offset++] = data;
	}
	fill(data: number, count: number) {
		for (let i = 0; i < count; i++) {
			this.putAndInc(data);
		}
	}
	atEnd() {
		return this.offset >= this.buffer.length;
	}

	/**
	 * Parses an array of C strings (null terminated char arrays). The strings
	 * must by one after another in memory and separated by nul bytes.
	 *
	 * The offset of `this` will be after the last byte.
	 *
	 * @returns array of strings, strings do not include the null byte
	 */
	getCStringArray(len?: number) {
		const start = this.offset;
		const rv: string[] = [];
		let strbuf = "";

		while (!this.atEnd() && (len === undefined || this.offset <= start + len)) {
			const char = this.getAndInc();
			if (char === 0) {
				rv.push(strbuf);
				strbuf = "";
			} else {
				strbuf += String.fromCharCode(char);
			}
		}

		return rv;
	}

	getUint16LeArray(byteLen?: number) {
		const start = this.offset;
		const rv: number[] = [];

		while (
			!this.atEnd() &&
			(byteLen === undefined || this.offset <= start + byteLen)
		) {
			rv.push(this.getAndInc16Le());
		}

		return rv;
	}

	getCString(len?: number) {
		if (len === undefined) {
			len = this.buffer.length;
		}
		const buffy = this.buffer.slice(this.offset, this.offset + len);
		this.offset += len;
		return textDecoder.decode(buffy as unknown as Uint8Array);
	}

	getPascalString() {
		const len = this.getAndInc();
		const buffy = this.buffer.slice(this.offset, this.offset + len);
		this.offset += len;
		return textDecoder.decode(buffy as unknown as Uint8Array);
	}

	getArrayBuffer(len: number) {
		const rv = this.buffer.slice(this.offset, this.offset + len);
		this.offset += len;
		return rv;
	}
}
