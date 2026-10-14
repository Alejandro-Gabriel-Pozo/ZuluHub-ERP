import type * as NodeCrypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La comparación en tiempo constante no se puede observar por el resultado (`===` da lo mismo), así que se
 * espía `timingSafeEqual`: tiene que ser lo que decide, y siempre sobre dos huellas de 32 bytes.
 */
const espia = vi.hoisted(() => ({ llamadas: [] as [number, number][] }));
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof NodeCrypto>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      espia.llamadas.push([a.byteLength, b.byteLength]);
      return real.timingSafeEqual(a, b);
    },
  };
});

import { autorizadoPorElCron } from "./autorizacion-de-cron";

const SECRETO = "el-secreto-largo-del-cron-de-prueba";

beforeEach(() => {
  espia.llamadas.length = 0;
});

describe("autorizadoPorElCron", () => {
  it("autoriza solo con «Bearer » y el secreto exacto", () => {
    expect(autorizadoPorElCron(`Bearer ${SECRETO}`, SECRETO)).toBe(true);
  });

  it.each([
    ["sin cabecera", null],
    ["cabecera vacía", ""],
    ["solo el esquema", "Bearer "],
    ["solo el esquema sin espacio", "Bearer"],
    ["el secreto sin esquema", SECRETO],
    ["otro esquema", `Basic ${SECRETO}`],
    ["esquema en minúscula", `bearer ${SECRETO}`],
    ["esquema en mayúscula", `BEARER ${SECRETO}`],
    ["dos espacios", `Bearer  ${SECRETO}`],
    ["secreto con un espacio al final", `Bearer ${SECRETO} `],
    ["secreto con un espacio al principio", `Bearer  ${SECRETO}`],
    ["secreto con salto de línea", `Bearer ${SECRETO}\n`],
    ["un carácter menos", `Bearer ${SECRETO.slice(0, -1)}`],
    ["un carácter más", `Bearer ${SECRETO}x`],
    ["un carácter distinto al final", `Bearer ${SECRETO.slice(0, -1)}X`],
    ["un carácter distinto al principio", `Bearer X${SECRETO.slice(1)}`],
    ["mayúsculas del secreto", `Bearer ${SECRETO.toUpperCase()}`],
    ["el secreto repetido", `Bearer ${SECRETO}${SECRETO}`],
    ["el esquema dentro del secreto", `Bearer Bearer ${SECRETO}`],
  ])("rechaza: %s", (_cual, cabecera) => {
    expect(autorizadoPorElCron(cabecera, SECRETO)).toBe(false);
  });

  it("un secreto vacío no autoriza a nadie, ni a «Bearer » vacío", () => {
    expect(autorizadoPorElCron("Bearer ", "")).toBe(false);
    expect(autorizadoPorElCron("Bearer x", "")).toBe(false);
    expect(autorizadoPorElCron(null, "")).toBe(false);
  });

  it("funciona con secretos y cabeceras no ASCII", () => {
    expect(autorizadoPorElCron("Bearer ñandú-€-🔑", "ñandú-€-🔑")).toBe(true);
    expect(autorizadoPorElCron("Bearer ñandú-€-🔑", "ñandú-€-🔒")).toBe(false);
  });

  it("decide con timingSafeEqual sobre huellas de 32 bytes, sin importar el largo de lo presentado", () => {
    for (const presentado of ["", "x", SECRETO, `${SECRETO}${SECRETO}${SECRETO}`]) {
      espia.llamadas.length = 0;
      autorizadoPorElCron(`Bearer ${presentado}`, SECRETO);
      expect(espia.llamadas).toEqual([[32, 32]]);
    }
  });

  it("lo que ni siquiera tiene la forma no llega a comparar", () => {
    autorizadoPorElCron(null, SECRETO);
    autorizadoPorElCron(SECRETO, SECRETO);
    autorizadoPorElCron("Bearer x", "");
    expect(espia.llamadas).toEqual([]);
  });
});
