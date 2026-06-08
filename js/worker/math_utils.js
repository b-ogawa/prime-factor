function bigIntToBytesLE(bigInt) {
    if (bigInt === 0n) return new Uint8Array([0]);
    let hex = bigInt.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[len - 1 - i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function bytesToBigIntLE(bytes) {
    let hex = '';
    for (let i = bytes.length - 1; i >= 0; i--) {
        let b = bytes[i].toString(16);
        if (b.length === 1) b = '0' + b;
        hex += b;
    }
    return BigInt('0x' + hex);
}
