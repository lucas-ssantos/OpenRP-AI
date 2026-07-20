// Gera os PNGs usados pelo launcher (desktop entry + tray) sem depender de
// libs de imagem — útil para regenerar os ícones se a paleta mudar.
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++)
    {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf)
{
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data)
{
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function hexToRgb(hex)
{
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Desenha um círculo preenchido (com anti-aliasing na borda) sobre fundo transparente.
function makeCircleIconPng(size, colorHex)
{
    const [r, g, b] = hexToRgb(colorHex);
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.38;

    const raw = Buffer.alloc((1 + size * 4) * size);
    let offset = 0;
    for (let y = 0; y < size; y++)
    {
        raw[offset++] = 0; // filter: none
        for (let x = 0; x < size; x++)
        {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
            const a = Math.round(alpha * 255);
            raw[offset++] = r;
            raw[offset++] = g;
            raw[offset++] = b;
            raw[offset++] = a;
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const idat = zlib.deflateSync(raw);

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", idat),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

const icons = [
    // ícone neutro usado no desktop entry (menu de aplicativos)
    { file: "app-icon.png", size: 64, color: "#38bdf8" },
    // ícones de estado usados na bandeja do sistema
    { file: "icon-running.png", size: 32, color: "#22c55e" },
    { file: "icon-stopped.png", size: 32, color: "#64748b" },
];

for (const icon of icons)
{
    const png = makeCircleIconPng(icon.size, icon.color);
    fs.writeFileSync(path.join(__dirname, icon.file), png);
    console.log(`Gerado: ${icon.file}`);
}
