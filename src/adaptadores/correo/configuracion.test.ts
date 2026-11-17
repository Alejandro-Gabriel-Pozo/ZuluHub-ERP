import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  PEDERNAL_CORREO_REMITENTE,
  PEDERNAL_NOMBRE_DE_MARCA,
  PEDERNAL_RESEND_API_KEY,
  PEDERNAL_URL_BASE,
  armarFrom,
  citarNombreDeRemitente,
  leerConfiguracionDeCorreo,
} from "./configuracion";

// Valores de prueba inventados: no son credenciales de nada.
const CLAVE = "clave-de-prueba-123";
const BUENO = {
  [PEDERNAL_RESEND_API_KEY]: CLAVE,
  [PEDERNAL_CORREO_REMITENTE]: "Pedernal <no-responder@ejemplo.test>",
  [PEDERNAL_URL_BASE]: "https://app.ejemplo.test",
  [PEDERNAL_NOMBRE_DE_MARCA]: "Marca de Prueba",
};

function mensajeDe(entorno: Record<string, string | undefined>): string {
  try {
    leerConfiguracionDeCorreo(entorno);
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    return (error as Error).message;
  }
  throw new Error("tendría que haber fallado");
}

describe("leerConfiguracionDeCorreo", () => {
  it("los nombres de las variables son los acordados", () => {
    expect(PEDERNAL_RESEND_API_KEY).toBe("PEDERNAL_RESEND_API_KEY");
    expect(PEDERNAL_CORREO_REMITENTE).toBe("PEDERNAL_CORREO_REMITENTE");
    expect(PEDERNAL_URL_BASE).toBe("PEDERNAL_URL_BASE");
    expect(PEDERNAL_NOMBRE_DE_MARCA).toBe("PEDERNAL_NOMBRE_DE_MARCA");
  });

  it("con las tres variables devuelve la configuración", () => {
    expect(leerConfiguracionDeCorreo(BUENO)).toEqual({
      claveDeApi: CLAVE,
      remitente: '"Pedernal" <no-responder@ejemplo.test>',
      urlBase: "https://app.ejemplo.test",
      nombreDeMarca: "Marca de Prueba",
    });
  });

  it("falla cerrado: sin ninguna variable, nombra las cuatro y nunca un valor", () => {
    const mensaje = mensajeDe({});
    expect(mensaje).toContain(`${PEDERNAL_RESEND_API_KEY} falta`);
    expect(mensaje).toContain(`${PEDERNAL_CORREO_REMITENTE} falta`);
    expect(mensaje).toContain(`${PEDERNAL_URL_BASE} falta`);
    expect(mensaje).toContain(`${PEDERNAL_NOMBRE_DE_MARCA} falta`);
  });

  it.each([
    PEDERNAL_RESEND_API_KEY,
    PEDERNAL_CORREO_REMITENTE,
    PEDERNAL_URL_BASE,
    PEDERNAL_NOMBRE_DE_MARCA,
  ])("si falta %s, falla nombrándola", (nombre) => {
    expect(mensajeDe({ ...BUENO, [nombre]: undefined })).toBe(
      `configuración de correo incompleta: ${nombre} falta`,
    );
    expect(mensajeDe({ ...BUENO, [nombre]: "   " })).toContain(`${nombre} falta`);
  });

  it("recorta los blancos de los valores", () => {
    const c = leerConfiguracionDeCorreo({
      [PEDERNAL_RESEND_API_KEY]: `  ${CLAVE}\n`,
      [PEDERNAL_CORREO_REMITENTE]: " no-responder@ejemplo.test ",
      [PEDERNAL_URL_BASE]: " https://app.ejemplo.test/ ",
      [PEDERNAL_NOMBRE_DE_MARCA]: "  Marca de Prueba\n",
    });
    expect(c).toEqual({
      claveDeApi: CLAVE,
      remitente: "no-responder@ejemplo.test",
      urlBase: "https://app.ejemplo.test",
      nombreDeMarca: "Marca de Prueba",
    });
  });

  it("el nombre de marca sin valor por defecto: no se inventa uno; admite acentos y &", () => {
    expect(
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_NOMBRE_DE_MARCA]: "Ñandú & Co" })
        .nombreDeMarca,
    ).toBe("Ñandú & Co");
  });

  const marca = (valor: string) =>
    leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_NOMBRE_DE_MARCA]: valor });
  const malaMarca = (valor: string) => mensajeDe({ ...BUENO, [PEDERNAL_NOMBRE_DE_MARCA]: valor });
  const SIN_CARACTERES = `configuración de correo incompleta: ${PEDERNAL_NOMBRE_DE_MARCA} inválida: tiene caracteres no admitidos`;

  it("el nombre de marca usa la lista de permitidos de una línea y devuelve su forma canónica", () => {
    expect(marca("  Pérez   &  Hijos S.A.  ").nombreDeMarca).toBe("Pérez & Hijos S.A.");
    expect(marca("D'Angelo (Sur) + Co").nombreDeMarca).toBe("D'Angelo (Sur) + Co");
    expect(marca("Cafe\u0301").nombreDeMarca).toBe("Café");
  });

  it.each([
    "Uno\nDos",
    "Uno\tDos",
    "Uno<Dos",
    "Uno>Dos",
    "<b>Uno</b>",
    "Uno\u200bDos",
    "Uno\u202eDos",
    "Uno\u0000Dos",
    "Uno 😀",
    "小林商事",
    "Uno=Dos",
    "Uno@Dos",
    "Uno_Dos",
    "+Uno",
    "-Uno",
  ])("el nombre de marca rechaza %j", (valor) => {
    expect(malaMarca(valor)).toBe(SIN_CARACTERES);
  });

  it("el nombre de marca rechaza más de 60 caracteres y acepta justo 60", () => {
    expect(malaMarca("x".repeat(61))).toBe(
      `configuración de correo incompleta: ${PEDERNAL_NOMBRE_DE_MARCA} inválida: no puede pasar de 60 caracteres`,
    );
    expect(marca("x".repeat(60)).nombreDeMarca).toHaveLength(60);
  });

  it("la clave de API no puede tener espacios, y el mensaje no la repite", () => {
    const mensaje = mensajeDe({ ...BUENO, [PEDERNAL_RESEND_API_KEY]: "con espacio adentro" });
    expect(mensaje).toContain(`${PEDERNAL_RESEND_API_KEY} inválida`);
    expect(mensaje).not.toContain("con espacio adentro");
  });

  it.each([
    "sin-arroba.test",
    "dos@@ejemplo.test",
    "a@b",
    "Nombre <no-responder@ejemplo.test",
    "<no-responder@ejemplo.test>",
    "   <no-responder@ejemplo.test>",
    "Nombre <a@b>",
    "Nombre <no-responder@ejemplo.test> basura",
    "uno@ejemplo.test, dos@ejemplo.test",
    "inyección\r\nBcc: x@y.test <a@ejemplo.test>",
    "a@ejemplo.test\r\nBcc: x@y.test",
    "Nombre\r\nBcc: x@y.test <a@ejemplo.test>",
    "a b@ejemplo.test",
    'a"b@ejemplo.test',
    "a;b@ejemplo.test",
    "a,b@ejemplo.test",
    "a<b@ejemplo.test",
    "ñandú@ejemplo.test",
    "a@ejemplo.test.",
    "a@.ejemplo.test",
    "a@eje mplo.test",
    "a@ejemplo..test",
    "a@ejemplo_x.test",
    "a@ejemplo.test>",
    "Nombre <a@ejemplo.test>>",
    "Nombre <<a@ejemplo.test>",
    "Nom<bre <a@ejemplo.test>",
    "Nombre <a<b@ejemplo.test>",
    "Nombre ‮<a@ejemplo.test>",
    "😀 <a@ejemplo.test>",
    "Nombre a@ejemplo.test>",
    `${"a".repeat(243)}@ejemplo.test`,
  ])("rechaza el remitente %j", (remitente) => {
    expect(mensajeDe({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: remitente })).toContain(
      `${PEDERNAL_CORREO_REMITENTE} inválida`,
    );
  });

  it("el tope de 254 de la dirección es el de la primitiva de contacto", () => {
    const justa = `${"a".repeat(254 - "@ejemplo.test".length)}@ejemplo.test`;
    expect(justa).toHaveLength(254);
    expect(
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: justa }).remitente,
    ).toBe(justa);
    expect(mensajeDe({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: `a${justa}` })).toContain(
      `${PEDERNAL_CORREO_REMITENTE} inválida`,
    );
  });

  it("el nombre del remitente usa la misma lista que la marca y tiene el mismo tope", () => {
    const con = (r: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: r }).remitente;
    // Un salto de línea en los extremos del nombre se recorta (normalización de la primitiva) y nunca llega al encabezado.
    expect(con("Nombre\n<a@ejemplo.test>")).toBe('"Nombre" <a@ejemplo.test>');
    expect(con("  Pérez  &  Hijos<a@ejemplo.test>")).toBe('"Pérez & Hijos" <a@ejemplo.test>');
    expect(con(`${"x".repeat(60)} <a@ejemplo.test>`)).toBe(`"${"x".repeat(60)}" <a@ejemplo.test>`);
    expect(() => con(`${"x".repeat(61)} <a@ejemplo.test>`)).toThrow(ErrorDeConfiguracion);
  });

  it.each(["A.B_c-d+e%f@sub.ejemplo-1.test", "Z9@a-b.co", "MAYUS@Ejemplo.TEST"])(
    "acepta la dirección %j",
    (d) => {
      expect(
        leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: d }).remitente,
      ).toBe(d);
    },
  );

  it.each([
    ["no-responder@ejemplo.test", "no-responder@ejemplo.test"],
    ["Pedernal <no-responder@ejemplo.test>", '"Pedernal" <no-responder@ejemplo.test>'],
  ])("acepta el remitente %j y lo deja listo para el encabezado", (remitente, esperado) => {
    expect(
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: remitente }).remitente,
    ).toBe(esperado);
  });

  it.each([
    ["no es una URL", "app.ejemplo.test"],
    ["http fuera de localhost", "http://app.ejemplo.test"],
    ["otro protocolo", "ftp://app.ejemplo.test"],
    ["otro protocolo en localhost", "ftp://localhost"],
    ["con usuario", "https://usuario@app.ejemplo.test"],
    ["con contraseña", "https://:clave@app.ejemplo.test"],
    ["con parámetros", "https://app.ejemplo.test/?a=1"],
    ["con fragmento", "https://app.ejemplo.test/#x"],
  ])("rechaza la URL base %s", (_motivo, url) => {
    const mensaje = mensajeDe({ ...BUENO, [PEDERNAL_URL_BASE]: url });
    expect(mensaje).toContain(`${PEDERNAL_URL_BASE} inválida`);
    expect(mensaje).not.toContain(url);
  });

  it("normaliza la URL base: sin barras finales, conservando una ruta", () => {
    const leer = (url: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_URL_BASE]: url }).urlBase;
    expect(leer("https://app.ejemplo.test/")).toBe("https://app.ejemplo.test");
    expect(leer("https://app.ejemplo.test///")).toBe("https://app.ejemplo.test");
    expect(leer("https://app.ejemplo.test/zulu/")).toBe("https://app.ejemplo.test/zulu");
    expect(leer("https://APP.ejemplo.test:8443")).toBe("https://app.ejemplo.test:8443");
  });

  it("admite http solo para localhost (desarrollo)", () => {
    const leer = (url: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_URL_BASE]: url }).urlBase;
    expect(leer("http://localhost:3000")).toBe("http://localhost:3000");
    expect(leer("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(leer("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("cada problema se informa con su motivo exacto", () => {
    expect(mensajeDe({ ...BUENO, [PEDERNAL_URL_BASE]: "app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_URL_BASE} inválida: no es una URL absoluta`,
    );
    expect(mensajeDe({ ...BUENO, [PEDERNAL_URL_BASE]: "http://app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_URL_BASE} inválida: tiene que ser https (http solo para localhost)`,
    );
    expect(mensajeDe({ ...BUENO, [PEDERNAL_URL_BASE]: "https://u@app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_URL_BASE} inválida: no puede llevar usuario`,
    );
    expect(mensajeDe({ ...BUENO, [PEDERNAL_URL_BASE]: "https://app.ejemplo.test/?a=1" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_URL_BASE} inválida: no puede llevar parámetros ni fragmento`,
    );
    expect(mensajeDe({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: "mal" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_CORREO_REMITENTE} inválida: se espera direccion@dominio o Nombre <direccion@dominio>`,
    );
    expect(mensajeDe({ ...BUENO, [PEDERNAL_RESEND_API_KEY]: "a b" })).toBe(
      `configuración de correo incompleta: ${PEDERNAL_RESEND_API_KEY} inválida: no puede tener espacios`,
    );
  });

  it("junta todos los problemas en un solo error", () => {
    const mensaje = mensajeDe({
      [PEDERNAL_RESEND_API_KEY]: "a b",
      [PEDERNAL_CORREO_REMITENTE]: "mal",
      [PEDERNAL_URL_BASE]: "http://x.test",
      [PEDERNAL_NOMBRE_DE_MARCA]: "a<b",
    });
    expect(mensaje.split("; ")).toHaveLength(4);
  });
});

describe("el encabezado From (armarFrom y citarNombreDeRemitente)", () => {
  const D = "a@ejemplo.test";

  it.each([
    ["normal", "Pedernal", '"Pedernal" <a@ejemplo.test>'],
    ["con coma", "Hotel Sol, Spa", '"Hotel Sol, Spa" <a@ejemplo.test>'],
    ["con punto y coma", "Sol; Luna", '"Sol; Luna" <a@ejemplo.test>'],
    ["con dos puntos", "Reservas: Hotel", '"Reservas: Hotel" <a@ejemplo.test>'],
    ["con comillas", 'El "Sol"', '"El \\"Sol\\"" <a@ejemplo.test>'],
    ["con comilla sin cierre", 'Sol"', '"Sol\\"" <a@ejemplo.test>'],
    ["con espacios de más", "  Pérez   Hijos ", '"Pérez Hijos" <a@ejemplo.test>'],
  ])("%s: el nombre sale citado y entero", (_caso, nombre, esperado) => {
    expect(armarFrom(nombre, D)).toBe(esperado);
  });

  it("citar escapa la barra invertida y la comilla, en ese orden de lectura (tabla exacta)", () => {
    expect(citarNombreDeRemitente("Sol")).toBe('"Sol"');
    expect(citarNombreDeRemitente('a"b')).toBe('"a\\"b"');
    expect(citarNombreDeRemitente("a\\b")).toBe('"a\\\\b"');
    expect(citarNombreDeRemitente('\\"')).toBe('"\\\\\\""');
    expect(citarNombreDeRemitente("")).toBe('""');
  });

  it("falla cerrado: nombre vacío, o con salto de línea, <, > o @ en el medio nunca llegan al encabezado", () => {
    for (const nombre of [
      "",
      "   ",
      "Sol\r\nBcc: x@y.test",
      "Sol\nLuna",
      "Sol\rLuna",
      "Sol<Luna",
      "Sol>Luna",
      "Sol@Luna",
      "Sol\\Luna",
      "😀",
    ]) {
      expect(armarFrom(nombre, D), JSON.stringify(nombre)).toBeNull();
    }
  });

  it("falla cerrado si la dirección no sirve", () => {
    expect(armarFrom("Sol", "a@b")).toBeNull();
    expect(armarFrom("Sol", "a@b.test, c@d.test")).toBeNull();
    expect(armarFrom("Sol", "a@b.test>\r\nBcc: x@y.test")).toBeNull();
  });

  it("es idempotente: la misma entrada da la misma salida, y repetir sobre un nombre ya canónico no lo cambia", () => {
    const una = armarFrom("Hotel Sol, Spa", D);
    expect(armarFrom("Hotel Sol, Spa", D)).toBe(una);
    expect(armarFrom("Hotel Sol, Spa", D)).toBe(armarFrom(" Hotel  Sol, Spa ", D));
  });

  it("por la configuración: un nombre con coma, punto y coma, dos puntos o comillas se acepta y sale citado", () => {
    const con = (r: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [PEDERNAL_CORREO_REMITENTE]: r }).remitente;
    expect(con("Hotel Sol, Spa <a@ejemplo.test>")).toBe('"Hotel Sol, Spa" <a@ejemplo.test>');
    expect(con('Sol: "Luna"; Mar <a@ejemplo.test>')).toBe(
      '"Sol: \\"Luna\\"; Mar" <a@ejemplo.test>',
    );
  });
});
