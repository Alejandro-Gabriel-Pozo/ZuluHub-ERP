import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  ZULUHUB_CORREO_REMITENTE,
  ZULUHUB_NOMBRE_DE_MARCA,
  ZULUHUB_RESEND_API_KEY,
  ZULUHUB_URL_BASE,
  leerConfiguracionDeCorreo,
} from "./configuracion";

// Valores de prueba inventados: no son credenciales de nada.
const CLAVE = "clave-de-prueba-123";
const BUENO = {
  [ZULUHUB_RESEND_API_KEY]: CLAVE,
  [ZULUHUB_CORREO_REMITENTE]: "ZuluHub <no-responder@ejemplo.test>",
  [ZULUHUB_URL_BASE]: "https://app.ejemplo.test",
  [ZULUHUB_NOMBRE_DE_MARCA]: "Marca de Prueba",
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
    expect(ZULUHUB_RESEND_API_KEY).toBe("ZULUHUB_RESEND_API_KEY");
    expect(ZULUHUB_CORREO_REMITENTE).toBe("ZULUHUB_CORREO_REMITENTE");
    expect(ZULUHUB_URL_BASE).toBe("ZULUHUB_URL_BASE");
    expect(ZULUHUB_NOMBRE_DE_MARCA).toBe("ZULUHUB_NOMBRE_DE_MARCA");
  });

  it("con las tres variables devuelve la configuración", () => {
    expect(leerConfiguracionDeCorreo(BUENO)).toEqual({
      claveDeApi: CLAVE,
      remitente: "ZuluHub <no-responder@ejemplo.test>",
      urlBase: "https://app.ejemplo.test",
      nombreDeMarca: "Marca de Prueba",
    });
  });

  it("falla cerrado: sin ninguna variable, nombra las cuatro y nunca un valor", () => {
    const mensaje = mensajeDe({});
    expect(mensaje).toContain(`${ZULUHUB_RESEND_API_KEY} falta`);
    expect(mensaje).toContain(`${ZULUHUB_CORREO_REMITENTE} falta`);
    expect(mensaje).toContain(`${ZULUHUB_URL_BASE} falta`);
    expect(mensaje).toContain(`${ZULUHUB_NOMBRE_DE_MARCA} falta`);
  });

  it.each([
    ZULUHUB_RESEND_API_KEY,
    ZULUHUB_CORREO_REMITENTE,
    ZULUHUB_URL_BASE,
    ZULUHUB_NOMBRE_DE_MARCA,
  ])("si falta %s, falla nombrándola", (nombre) => {
    expect(mensajeDe({ ...BUENO, [nombre]: undefined })).toBe(
      `configuración de correo incompleta: ${nombre} falta`,
    );
    expect(mensajeDe({ ...BUENO, [nombre]: "   " })).toContain(`${nombre} falta`);
  });

  it("recorta los blancos de los valores", () => {
    const c = leerConfiguracionDeCorreo({
      [ZULUHUB_RESEND_API_KEY]: `  ${CLAVE}\n`,
      [ZULUHUB_CORREO_REMITENTE]: " no-responder@ejemplo.test ",
      [ZULUHUB_URL_BASE]: " https://app.ejemplo.test/ ",
      [ZULUHUB_NOMBRE_DE_MARCA]: "  Marca de Prueba\n",
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
      leerConfiguracionDeCorreo({ ...BUENO, [ZULUHUB_NOMBRE_DE_MARCA]: "Ñandú & Co" })
        .nombreDeMarca,
    ).toBe("Ñandú & Co");
  });

  it("el nombre de marca rechaza saltos de línea, signos < > y largos de más de 60", () => {
    const mal = (valor: string) => mensajeDe({ ...BUENO, [ZULUHUB_NOMBRE_DE_MARCA]: valor });
    expect(mal("Uno\nDos")).toBe(
      `configuración de correo incompleta: ${ZULUHUB_NOMBRE_DE_MARCA} inválida: no puede tener caracteres de control ni < >`,
    );
    expect(mal("Uno<Dos")).toContain("caracteres de control ni < >");
    expect(mal("Uno>Dos")).toContain("caracteres de control ni < >");
    expect(mal("x".repeat(61))).toBe(
      `configuración de correo incompleta: ${ZULUHUB_NOMBRE_DE_MARCA} inválida: no puede pasar de 60 caracteres`,
    );
    expect(
      leerConfiguracionDeCorreo({ ...BUENO, [ZULUHUB_NOMBRE_DE_MARCA]: "x".repeat(60) })
        .nombreDeMarca,
    ).toHaveLength(60);
  });

  it("la clave de API no puede tener espacios, y el mensaje no la repite", () => {
    const mensaje = mensajeDe({ ...BUENO, [ZULUHUB_RESEND_API_KEY]: "con espacio adentro" });
    expect(mensaje).toContain(`${ZULUHUB_RESEND_API_KEY} inválida`);
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
  ])("rechaza el remitente %j", (remitente) => {
    expect(mensajeDe({ ...BUENO, [ZULUHUB_CORREO_REMITENTE]: remitente })).toContain(
      `${ZULUHUB_CORREO_REMITENTE} inválida`,
    );
  });

  it.each(["no-responder@ejemplo.test", "ZuluHub <no-responder@ejemplo.test>"])(
    "acepta el remitente %j",
    (remitente) => {
      expect(
        leerConfiguracionDeCorreo({ ...BUENO, [ZULUHUB_CORREO_REMITENTE]: remitente }).remitente,
      ).toBe(remitente);
    },
  );

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
    const mensaje = mensajeDe({ ...BUENO, [ZULUHUB_URL_BASE]: url });
    expect(mensaje).toContain(`${ZULUHUB_URL_BASE} inválida`);
    expect(mensaje).not.toContain(url);
  });

  it("normaliza la URL base: sin barras finales, conservando una ruta", () => {
    const leer = (url: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [ZULUHUB_URL_BASE]: url }).urlBase;
    expect(leer("https://app.ejemplo.test/")).toBe("https://app.ejemplo.test");
    expect(leer("https://app.ejemplo.test///")).toBe("https://app.ejemplo.test");
    expect(leer("https://app.ejemplo.test/zulu/")).toBe("https://app.ejemplo.test/zulu");
    expect(leer("https://APP.ejemplo.test:8443")).toBe("https://app.ejemplo.test:8443");
  });

  it("admite http solo para localhost (desarrollo)", () => {
    const leer = (url: string) =>
      leerConfiguracionDeCorreo({ ...BUENO, [ZULUHUB_URL_BASE]: url }).urlBase;
    expect(leer("http://localhost:3000")).toBe("http://localhost:3000");
    expect(leer("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(leer("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("cada problema se informa con su motivo exacto", () => {
    expect(mensajeDe({ ...BUENO, [ZULUHUB_URL_BASE]: "app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_URL_BASE} inválida: no es una URL absoluta`,
    );
    expect(mensajeDe({ ...BUENO, [ZULUHUB_URL_BASE]: "http://app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_URL_BASE} inválida: tiene que ser https (http solo para localhost)`,
    );
    expect(mensajeDe({ ...BUENO, [ZULUHUB_URL_BASE]: "https://u@app.ejemplo.test" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_URL_BASE} inválida: no puede llevar usuario`,
    );
    expect(mensajeDe({ ...BUENO, [ZULUHUB_URL_BASE]: "https://app.ejemplo.test/?a=1" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_URL_BASE} inválida: no puede llevar parámetros ni fragmento`,
    );
    expect(mensajeDe({ ...BUENO, [ZULUHUB_CORREO_REMITENTE]: "mal" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_CORREO_REMITENTE} inválida: se espera direccion@dominio o Nombre <direccion@dominio>`,
    );
    expect(mensajeDe({ ...BUENO, [ZULUHUB_RESEND_API_KEY]: "a b" })).toBe(
      `configuración de correo incompleta: ${ZULUHUB_RESEND_API_KEY} inválida: no puede tener espacios`,
    );
  });

  it("junta todos los problemas en un solo error", () => {
    const mensaje = mensajeDe({
      [ZULUHUB_RESEND_API_KEY]: "a b",
      [ZULUHUB_CORREO_REMITENTE]: "mal",
      [ZULUHUB_URL_BASE]: "http://x.test",
      [ZULUHUB_NOMBRE_DE_MARCA]: "a<b",
    });
    expect(mensaje.split("; ")).toHaveLength(4);
  });
});
