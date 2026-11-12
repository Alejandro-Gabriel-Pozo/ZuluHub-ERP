import { describe, expect, it } from "vitest";
import {
  cartaPublicaId,
  copiaDeOpcionesId,
  esUuid,
  grupoDeEleccionesId,
  opcionId,
  precioDeVentaId,
  productoId,
  seccionDeCartaId,
  versionDeOpcionId,
} from "./identificadores";

describe("esUuid: un id del catálogo es un uuid", () => {
  it("acepta el formato 8-4-4-4-12 en hexadecimal, en mayúsculas o minúsculas", () => {
    for (const uuid of [
      "00000000-0000-4000-8000-000000000001",
      "ABCDEF01-2345-6789-ABCD-EF0123456789",
      "abcdef01-2345-6789-abcd-ef0123456789",
    ]) {
      expect(esUuid(uuid), uuid).toBe(true);
    }
  });

  it("rechaza lo que no tiene exactamente esa forma: de más, de menos, sin guiones, con otros caracteres o con saltos de línea", () => {
    for (const malo of [
      "",
      "no-es-un-uuid",
      "00000000-0000-4000-8000-00000000000",
      "00000000-0000-4000-8000-0000000000012",
      "0000000000004000800000000000001",
      "00000000-0000-4000-8000-00000000000g",
      "x00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001x",
      "00000000-0000-4000-8000-000000000001\n",
      "\n00000000-0000-4000-8000-000000000001",
    ]) {
      expect(esUuid(malo), JSON.stringify(malo)).toBe(false);
    }
  });
});

describe("las marcas de identificador no cambian el valor", () => {
  it("cada una devuelve el mismo texto que recibe", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const marcar of [
      productoId,
      seccionDeCartaId,
      grupoDeEleccionesId,
      opcionId,
      versionDeOpcionId,
      precioDeVentaId,
      copiaDeOpcionesId,
      cartaPublicaId,
    ]) {
      expect(marcar(id)).toBe(id);
    }
  });
});
