import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { empresaId } from "../../primitivas/identificadores/marca";
import { Secreto } from "../../primitivas/secreto/secreto";
import type { DondeSeGuarda } from "../../puertos/cifrado-de-secretos";
import { ErrorDeConfiguracion } from "../postgres/errores";
import { crearCifradorAesGcm, parsearClaveMaestra, type ClaveMaestra } from "./aes-gcm";

/**
 * El cifrado de secretos (§B.6.3). Las claves salen de la propia prueba (azar): nunca una clave real.
 */

const maestra = (kid: string): ClaveMaestra => ({ kid, clave: randomBytes(32) });
const K1 = maestra("k1");
const K2 = maestra("k2");

const DONDE: DondeSeGuarda = {
  empresaId: empresaId("empresa-1"),
  tabla: "certificado_arca",
  filaId: "fila-1",
  columna: "clave_cifrada",
};
const CLAVE_PRIVADA = "-----BEGIN PRIVATE KEY-----\nclave-de-prueba\n-----END PRIVATE KEY-----";

describe("cifrado AES-256-GCM", () => {
  it("cifra y descifra; el texto cifrado no contiene el secreto y lleva nonce de 12, etiqueta de 16 y el kid activo", () => {
    const cifrador = crearCifradorAesGcm({ activa: K1 });
    const texto = cifrador.cifrar(new Secreto(CLAVE_PRIVADA), DONDE);
    expect(texto.kid).toBe("k1");
    expect(texto.nonce).toHaveLength(12);
    expect(texto.etiqueta).toHaveLength(16);
    expect(Buffer.from(texto.cifrado).toString("utf8")).not.toContain("clave-de-prueba");
    expect(Buffer.from(texto.cifrado).toString("base64")).not.toContain("clave-de-prueba");
    expect(cifrador.descifrar(texto, DONDE)?.revelar()).toBe(CLAVE_PRIVADA);
  });

  it("dos cifrados del mismo secreto no se parecen (nonce nuevo cada vez)", () => {
    const cifrador = crearCifradorAesGcm({ activa: K1 });
    const a = cifrador.cifrar(new Secreto(CLAVE_PRIVADA), DONDE);
    const b = cifrador.cifrar(new Secreto(CLAVE_PRIVADA), DONDE);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.cifrado).equals(Buffer.from(b.cifrado))).toBe(false);
  });

  it("el nonce sale del generador de azar pedido de 12 bytes", () => {
    const pedidos: number[] = [];
    const cifrador = crearCifradorAesGcm({ activa: K1 }, (n) => {
      pedidos.push(n);
      return Buffer.alloc(n, 7);
    });
    const texto = cifrador.cifrar(new Secreto("x"), DONDE);
    expect(pedidos).toEqual([12]);
    expect(Buffer.from(texto.nonce).equals(Buffer.alloc(12, 7))).toBe(true);
  });

  it("un secreto vacío y uno con acentos y símbolos vuelven iguales", () => {
    const cifrador = crearCifradorAesGcm({ activa: K1 });
    for (const claro of ["", "ñandú ✓ — “comillas”"]) {
      expect(cifrador.descifrar(cifrador.cifrar(new Secreto(claro), DONDE), DONDE)?.revelar()).toBe(
        claro,
      );
    }
  });

  describe("el texto está atado a su lugar (AAD)", () => {
    const cifrador = crearCifradorAesGcm({ activa: K1 });
    const texto = cifrador.cifrar(new Secreto(CLAVE_PRIVADA), DONDE);

    it.each([
      ["otra fila", { ...DONDE, filaId: "fila-2" }],
      ["otra columna", { ...DONDE, columna: "credencial_cifrada" }],
      ["otra tabla", { ...DONDE, tabla: "acceso_arca" }],
      ["otra empresa", { ...DONDE, empresaId: empresaId("empresa-2") }],
    ])("movido a %s no descifra", (_nombre, otro) => {
      expect(cifrador.descifrar(texto, otro)).toBeNull();
    });

    it("las partes no se confunden aunque una lleve el separador", () => {
      const a = { ...DONDE, tabla: "a|b", filaId: "c" };
      const b = { ...DONDE, tabla: "a", filaId: "b|c" };
      const t = cifrador.cifrar(new Secreto("x"), a);
      expect(cifrador.descifrar(t, a)?.revelar()).toBe("x");
      expect(cifrador.descifrar(t, b)).toBeNull();
    });
  });

  describe("lo alterado no descifra (y no dice por qué)", () => {
    const cifrador = crearCifradorAesGcm({ activa: K1 });
    const texto = cifrador.cifrar(new Secreto(CLAVE_PRIVADA), DONDE);
    const cambiar = (bytes: Uint8Array): Uint8Array => {
      const copia = Buffer.from(bytes);
      copia[0] = (copia[0] ?? 0) ^ 1;
      return copia;
    };

    it("un bit cambiado en el texto, el nonce o la etiqueta", () => {
      expect(cifrador.descifrar({ ...texto, cifrado: cambiar(texto.cifrado) }, DONDE)).toBeNull();
      expect(cifrador.descifrar({ ...texto, nonce: cambiar(texto.nonce) }, DONDE)).toBeNull();
      expect(cifrador.descifrar({ ...texto, etiqueta: cambiar(texto.etiqueta) }, DONDE)).toBeNull();
    });

    it("nonce o etiqueta de otro largo", () => {
      expect(cifrador.descifrar({ ...texto, nonce: texto.nonce.slice(1) }, DONDE)).toBeNull();
      expect(cifrador.descifrar({ ...texto, etiqueta: texto.etiqueta.slice(1) }, DONDE)).toBeNull();
      expect(
        cifrador.descifrar(
          { ...texto, etiqueta: Buffer.concat([texto.etiqueta, Buffer.alloc(1)]) },
          DONDE,
        ),
      ).toBeNull();
      expect(
        cifrador.descifrar(
          { ...texto, nonce: Buffer.concat([texto.nonce, Buffer.alloc(1)]) },
          DONDE,
        ),
      ).toBeNull();
    });

    it("un kid desconocido, o una clave maestra equivocada", () => {
      expect(cifrador.descifrar({ ...texto, kid: "k9" }, DONDE)).toBeNull();
      const otra = crearCifradorAesGcm({ activa: { kid: "k1", clave: randomBytes(32) } });
      expect(otra.descifrar(texto, DONDE)).toBeNull();
    });
  });

  describe("rotación de la clave maestra: se leen dos versiones", () => {
    it("lo cifrado con la vieja se sigue leyendo; lo nuevo se cifra con la activa", () => {
      const viejo = crearCifradorAesGcm({ activa: K1 }).cifrar(new Secreto("viejo"), DONDE);
      const rotado = crearCifradorAesGcm({ activa: K2, anteriores: [K1] });
      expect(viejo.kid).toBe("k1");
      expect(rotado.descifrar(viejo, DONDE)?.revelar()).toBe("viejo");
      const nuevo = rotado.cifrar(new Secreto("nuevo"), DONDE);
      expect(nuevo.kid).toBe("k2");
      expect(rotado.descifrar(nuevo, DONDE)?.revelar()).toBe("nuevo");
      // Quien todavía no conoce la nueva no lee lo nuevo.
      expect(crearCifradorAesGcm({ activa: K1 }).descifrar(nuevo, DONDE)).toBeNull();
    });

    it("sin la clave vieja en `anteriores`, lo viejo deja de leerse", () => {
      const viejo = crearCifradorAesGcm({ activa: K1 }).cifrar(new Secreto("viejo"), DONDE);
      expect(crearCifradorAesGcm({ activa: K2 }).descifrar(viejo, DONDE)).toBeNull();
    });
  });

  describe("claves maestras inválidas: falla cerrado sin repetir la clave", () => {
    it.each([
      ["un kid vacío", { kid: "", clave: randomBytes(32) }],
      ["un kid con espacios", { kid: "k 1", clave: randomBytes(32) }],
      ["un kid de 51 caracteres", { kid: "k".repeat(51), clave: randomBytes(32) }],
      ["una clave de 31 bytes", { kid: "k1", clave: randomBytes(31) }],
      ["una clave de 33 bytes", { kid: "k1", clave: randomBytes(33) }],
    ])("%s", (_nombre, activa) => {
      expect(() => crearCifradorAesGcm({ activa })).toThrow(ErrorDeConfiguracion);
    });

    it("un kid repetido entre la activa y una anterior", () => {
      expect(() => crearCifradorAesGcm({ activa: K1, anteriores: [{ ...K2, kid: "k1" }] })).toThrow(
        ErrorDeConfiguracion,
      );
    });

    it("un kid de 50 caracteres sí se acepta", () => {
      expect(() =>
        crearCifradorAesGcm({ activa: { kid: "k".repeat(50), clave: randomBytes(32) } }),
      ).not.toThrow();
    });
  });
});

describe("parsearClaveMaestra", () => {
  const HEX = randomBytes(32).toString("hex");

  it("lee <kid>:<64 hexadecimales> (con blancos alrededor y mayúsculas)", () => {
    const leida = parsearClaveMaestra(`  prod-2026.1:${HEX.toUpperCase()}\n`);
    expect(leida.kid).toBe("prod-2026.1");
    expect(leida.clave.toString("hex")).toBe(HEX);
  });

  it.each([
    ["sin separador", HEX],
    ["sin kid", `:${HEX}`],
    ["con kid inválido", `k 1:${HEX}`],
    ["con kid de 51 caracteres", `${"k".repeat(51)}:${HEX}`],
    ["con clave corta", `k1:${HEX.slice(2)}`],
    ["con clave larga", `k1:${HEX}00`],
    ["con clave que no es hexadecimal", `k1:${"z".repeat(64)}`],
    ["vacía", ""],
  ])("rechaza %s, y el mensaje no repite el valor", (_nombre, texto) => {
    let mensaje = "";
    try {
      parsearClaveMaestra(texto);
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorDeConfiguracion);
      mensaje = (e as Error).message;
    }
    expect(mensaje).not.toBe("");
    expect(mensaje).not.toContain(HEX);
    expect(mensaje).not.toContain(HEX.slice(0, 16));
  });
});
