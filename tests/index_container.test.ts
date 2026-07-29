import { describe, it, expect } from "vitest";
import {
  CONTAINER_FILE, CONTAINER_SCHEMA_VERSION, ContainerError,
  crc32, encodeContainer, decodeContainer,
} from "../src/index_container";
import { IndexManifest } from "../src/index";

const DIM = 4;
function makeManifest(count: number): IndexManifest & Record<string, unknown> {
  return {
    schema_version: CONTAINER_SCHEMA_VERSION, embedding_model: "fake-model",
    index_dim: DIM, scale: 127, count, granularity: "note", quant: "int8",
    built_at: "2026-07-29T08:00:00.000Z",
  };
}
function makeMatrix(count: number): Uint8Array {
  const m = new Uint8Array(count * DIM);
  for (let i = 0; i < m.length; i++) m[i] = (i * 37 + 3) % 251 - 125;
  return m;
}

describe("index_container", () => {
  it("Konstanten sind gepinnt", () => {
    expect(CONTAINER_FILE).toBe("index.bin");
    expect(CONTAINER_SCHEMA_VERSION).toBe(2);
  });

  it("crc32 liefert den bekannten Referenzwert", () => {
    // CRC-32/ISO-HDLC von "123456789" ist 0xCBF43926 (Standard-Prüfvektor).
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("Round-Trip: encode → decode ist byte-genau", () => {
    const paths = ["a.md", "b.md", "c/ä ö.md"];
    const matrix = makeMatrix(3);
    const buf = encodeContainer(makeManifest(3), paths, matrix);
    const out = decodeContainer(buf);
    expect(out.paths).toEqual(paths);
    expect(out.manifest.count).toBe(3);
    expect(out.manifest.embedding_model).toBe("fake-model");
    expect((out.manifest as { built_at?: string }).built_at).toBe("2026-07-29T08:00:00.000Z");
    expect(new Uint8Array(out.matrix)).toEqual(matrix);
  });

  it("0-Notizen-Index round-trippt", () => {
    const out = decodeContainer(encodeContainer(makeManifest(0), [], new Uint8Array(0)));
    expect(out.paths).toEqual([]);
    expect(out.matrix.byteLength).toBe(0);
  });

  it("Truncation an jeder Grenze wirft ContainerError", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(3), ["a.md", "b.md", "c.md"], makeMatrix(3)));
    // Schnitte: im Magic, direkt nach headerLen, mitten im Header, mitten in der Matrix, im CRC.
    const headerLen = new DataView(full.buffer).getUint32(4, true);
    const cuts = [2, 8, 8 + Math.floor(headerLen / 2), 8 + headerLen + 3, full.length - 2];
    for (const cut of cuts) {
      const cutBuf = full.slice(0, cut).buffer;
      expect(() => decodeContainer(cutBuf), `Schnitt bei ${cut}`).toThrow(ContainerError);
    }
  });

  it("Bit-Flip an beliebiger Position wirft (CRC)", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(3), ["a.md", "b.md", "c.md"], makeMatrix(3)));
    for (const pos of [0, 5, 10, 8 + 4, full.length - 6, full.length - 1]) {
      const bad = full.slice();
      bad[pos] = bad[pos] ^ 0xff;
      expect(() => decodeContainer(bad.buffer), `Flip bei ${pos}`).toThrow(ContainerError);
    }
  });

  it("falsches Magic wirft mit reason 'magic'", () => {
    const full = new Uint8Array(encodeContainer(makeManifest(1), ["a.md"], makeMatrix(1)));
    full[0] = 0x58; // "X..."
    try { decodeContainer(full.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("magic"); }
  });

  it("falsche schema_version wirft mit reason 'schema'", () => {
    const manifest = makeManifest(1);
    (manifest as { schema_version: number }).schema_version = 1;
    const buf = encodeContainer(manifest, ["a.md"], makeMatrix(1));
    // encodeContainer erzwingt schema_version 2 im Header — der Test prüft also,
    // dass ein von Hand gebauter v1-Header abgelehnt wird:
    const full = new Uint8Array(buf);
    const headerLen = new DataView(full.buffer).getUint32(4, true);
    const headerTxt = new TextDecoder().decode(full.subarray(8, 8 + headerLen));
    const v1 = headerTxt.replace('"schema_version":2', '"schema_version":1');
    expect(v1).not.toBe(headerTxt); // Ersetzung hat gegriffen
    const v1Bytes = new TextEncoder().encode(v1);
    const body = new Uint8Array(8 + v1Bytes.length + (full.length - 8 - headerLen));
    body.set(full.subarray(0, 8)); body.set(v1Bytes, 8);
    body.set(full.subarray(8 + headerLen, full.length - 4), 8 + v1Bytes.length);
    new DataView(body.buffer).setUint32(4, v1Bytes.length, true);
    const crc = crc32(body.subarray(0, body.length - 4));
    new DataView(body.buffer).setUint32(body.length - 4, crc, true);
    try { decodeContainer(body.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("schema"); }
  });

  it("kaputtes Header-JSON wirft mit reason 'header'", () => {
    // Gültige Hülle, aber Header ist kein JSON: von Hand bauen, CRC korrekt setzen.
    const headerBytes = new TextEncoder().encode("{nicht json");
    const body = new Uint8Array(8 + headerBytes.length + 4);
    body.set([0x56, 0x52, 0x49, 0x58]); // "VRIX"
    new DataView(body.buffer).setUint32(4, headerBytes.length, true);
    body.set(headerBytes, 8);
    const crc = crc32(body.subarray(0, body.length - 4));
    new DataView(body.buffer).setUint32(body.length - 4, crc, true);
    try { decodeContainer(body.buffer); expect.unreachable(); }
    catch (e) { expect((e as ContainerError).reason).toBe("header"); }
  });
});
