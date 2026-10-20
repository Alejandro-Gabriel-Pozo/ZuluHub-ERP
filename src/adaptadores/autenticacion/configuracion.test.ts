import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_ID_PLATAFORMA,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CLIENT_SECRET_PLATAFORMA,
  PEDERNAL_HOST_DE_LA_CONSOLA,
  CARACTERES_DISTINTOS_MINIMOS,
  LARGO_MINIMO_DEL_SECRETO,
  caracteresDistintos,
  PEDERNAL_AUTH_SECRETO_EMPRESA,
  PEDERNAL_AUTH_SECRETO_PLATAFORMA,
  leerClienteDeGoogle,
  leerClienteDeGoogleDePlataforma,
  leerHostDeLaConsola,
  leerSecretoDeAutenticacion,
  leerSecretoDeAutenticacionDePlataforma,
} from "./configuracion";

/** Valores inventados: lo que se comprueba es la forma de la validación y que ningún error repite el valor. */
const CENTINELA = "valor-secreto-inventado-xyz";

describe("nombres de las variables", () => {
  it("son los que el spec (§5.2) le dio al dueño", () => {
    expect(PEDERNAL_AUTH_SECRETO_EMPRESA).toBe("PEDERNAL_AUTH_SECRETO_EMPRESA");
    expect(GOOGLE_CLIENT_ID).toBe("GOOGLE_CLIENT_ID");
    expect(GOOGLE_CLIENT_SECRET).toBe("GOOGLE_CLIENT_SECRET");
  });

  it("el secreto de la consola de plataforma tiene su propio nombre, distinto del de empresa", () => {
    expect(PEDERNAL_AUTH_SECRETO_PLATAFORMA).toBe("PEDERNAL_AUTH_SECRETO_PLATAFORMA");
    expect(PEDERNAL_AUTH_SECRETO_PLATAFORMA).not.toBe(PEDERNAL_AUTH_SECRETO_EMPRESA);
  });

  it("el cliente de Google y el host de la consola tienen sus propios nombres, distintos de los de la web", () => {
    expect(GOOGLE_CLIENT_ID_PLATAFORMA).toBe("GOOGLE_CLIENT_ID_PLATAFORMA");
    expect(GOOGLE_CLIENT_SECRET_PLATAFORMA).toBe("GOOGLE_CLIENT_SECRET_PLATAFORMA");
    expect(PEDERNAL_HOST_DE_LA_CONSOLA).toBe("PEDERNAL_HOST_DE_LA_CONSOLA");
    expect(GOOGLE_CLIENT_ID_PLATAFORMA).not.toBe(GOOGLE_CLIENT_ID);
    expect(GOOGLE_CLIENT_SECRET_PLATAFORMA).not.toBe(GOOGLE_CLIENT_SECRET);
  });
});

describe("leerSecretoDeAutenticacionDePlataforma", () => {
  const de = (largo: number) => "0123456789abcdef".repeat(3).slice(0, largo);
  const con = (n: number, largo = 64) =>
    Array.from({ length: largo }, (_, i) => String.fromCharCode(97 + (i % n))).join("");
  const NOMBRE = "PEDERNAL_AUTH_SECRETO_PLATAFORMA";

  it("acepta lo mismo que el de empresa (32 caracteres, diez distintos) y lo devuelve sin blancos en los extremos", () => {
    expect(leerSecretoDeAutenticacionDePlataforma(de(32))).toBe(de(32));
    expect(leerSecretoDeAutenticacionDePlataforma(`  ${de(40)}\n`)).toBe(de(40));
    expect(leerSecretoDeAutenticacionDePlataforma(con(10))).toBe(con(10));
  });

  it.each([undefined, "", "   ", "\n"])(
    "falta (%j): el mensaje nombra la variable de la consola",
    (valor) => {
      expect(() => leerSecretoDeAutenticacionDePlataforma(valor)).toThrow(
        new ErrorDeConfiguracion(`${NOMBRE} inválido: falta`),
      );
    },
  );

  it("uno de 31 caracteres es corto y uno de 9 distintos es repetitivo, sin repetir el valor", () => {
    expect(() => leerSecretoDeAutenticacionDePlataforma(de(31))).toThrow(
      new ErrorDeConfiguracion(`${NOMBRE} inválido: necesita al menos 32 caracteres`),
    );
    expect(() => leerSecretoDeAutenticacionDePlataforma(con(9))).toThrow(
      new ErrorDeConfiguracion(`${NOMBRE} inválido: necesita al menos 10 caracteres distintos`),
    );
    try {
      leerSecretoDeAutenticacionDePlataforma(CENTINELA);
    } catch (e) {
      expect((e as Error).message).not.toContain(CENTINELA);
    }
  });

  it("nunca igual al de empresa: con el de empresa a la vista, el mismo valor (aun con blancos) no se arma", () => {
    const mensaje = new ErrorDeConfiguracion(
      `${NOMBRE} inválido: no puede ser igual a PEDERNAL_AUTH_SECRETO_EMPRESA`,
    );
    expect(() => leerSecretoDeAutenticacionDePlataforma(de(40), de(40))).toThrow(mensaje);
    expect(() => leerSecretoDeAutenticacionDePlataforma(de(40), `\n ${de(40)} `)).toThrow(mensaje);
    // Distinto, o sin el de empresa a la vista: pasa.
    expect(leerSecretoDeAutenticacionDePlataforma(de(40), de(41))).toBe(de(40));
    expect(leerSecretoDeAutenticacionDePlataforma(de(40), undefined)).toBe(de(40));
    expect(leerSecretoDeAutenticacionDePlataforma(de(40), "")).toBe(de(40));
  });

  it("el mensaje de «igual» no repite el valor", () => {
    try {
      leerSecretoDeAutenticacionDePlataforma(de(40), de(40));
    } catch (e) {
      expect((e as Error).message).not.toContain(de(40));
    }
  });

  it("la validación de largo y variedad corre antes de comparar con el de empresa", () => {
    expect(() => leerSecretoDeAutenticacionDePlataforma(de(10), de(10))).toThrow(
      `${NOMBRE} inválido: necesita al menos 32 caracteres`,
    );
  });
});

describe("leerSecretoDeAutenticacion", () => {
  /** Largo exacto con 16 caracteres distintos (pasa el largo y la variedad). */
  const de = (largo: number) => "0123456789abcdef".repeat(3).slice(0, largo);

  it("acepta un secreto de 32 caracteres o más y lo devuelve sin blancos en los extremos", () => {
    expect(LARGO_MINIMO_DEL_SECRETO).toBe(32);
    expect(leerSecretoDeAutenticacion(de(32))).toBe(de(32));
    expect(leerSecretoDeAutenticacion(`  ${de(40)}\n`)).toBe(de(40));
  });

  it("uno de 31 caracteres es corto, y los blancos no cuentan para el largo", () => {
    expect(() => leerSecretoDeAutenticacion(de(31))).toThrow(ErrorDeConfiguracion);
    expect(() => leerSecretoDeAutenticacion(` ${de(31)} `)).toThrow(ErrorDeConfiguracion);
  });

  it.each([undefined, "", "   ", "\n"])("falta (%j)", (valor) => {
    expect(() => leerSecretoDeAutenticacion(valor)).toThrow(
      new ErrorDeConfiguracion("PEDERNAL_AUTH_SECRETO_EMPRESA inválido: falta"),
    );
  });

  it("el motivo de uno corto se dice sin repetir el valor", () => {
    let error: unknown;
    try {
      leerSecretoDeAutenticacion(CENTINELA);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect((error as Error).message).toBe(
      "PEDERNAL_AUTH_SECRETO_EMPRESA inválido: necesita al menos 32 caracteres",
    );
    expect((error as Error).message).not.toContain(CENTINELA);
  });
});

describe("leerSecretoDeAutenticacion: variedad (M3)", () => {
  const MENSAJE =
    "PEDERNAL_AUTH_SECRETO_EMPRESA inválido: necesita al menos 10 caracteres distintos";
  /** `n` caracteres distintos repetidos hasta `largo`. */
  const con = (n: number, largo = 64) =>
    Array.from({ length: largo }, (_, i) => String.fromCharCode(97 + (i % n))).join("");

  it("el piso es de diez caracteres distintos, contados sin los blancos de los extremos", () => {
    expect(CARACTERES_DISTINTOS_MINIMOS).toBe(10);
    expect(caracteresDistintos("aabbc")).toBe(3);
    expect(caracteresDistintos("")).toBe(0);
    expect(() => leerSecretoDeAutenticacion(con(9))).toThrow(new ErrorDeConfiguracion(MENSAJE));
    expect(leerSecretoDeAutenticacion(con(10))).toBe(con(10));
    // Un blanco del medio cuenta como carácter; los de los extremos no (se recortan antes).
    expect(() => leerSecretoDeAutenticacion(`  ${con(9)}  `)).toThrow(MENSAJE);
  });

  it.each([
    ["un solo carácter repetido", "a".repeat(64)],
    ["dos que se alternan", "ab".repeat(32)],
    ["nueve distintos", con(9)],
    ["un solo número repetido", "7".repeat(40)],
  ])("rechaza %s", (_nombre, secreto) => {
    expect(() => leerSecretoDeAutenticacion(secreto)).toThrow(new ErrorDeConfiguracion(MENSAJE));
  });

  it("propiedad: con menos de diez caracteres distintos siempre se rechaza, sin repetir el valor", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.constantFrom(
            ..."!#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~",
          ),
          { minLength: 1, maxLength: CARACTERES_DISTINTOS_MINIMOS - 1 },
        ),
        fc.integer({ min: 32, max: 120 }),
        (alfabeto, largo) => {
          const secreto = Array.from(
            { length: largo },
            (_, i) => alfabeto[i % alfabeto.length],
          ).join("");
          const recortado = secreto.trim();
          fc.pre(recortado.length >= LARGO_MINIMO_DEL_SECRETO);
          let mensaje = "";
          try {
            leerSecretoDeAutenticacion(secreto);
          } catch (e) {
            mensaje = (e as Error).message;
          }
          expect(mensaje).toBe(MENSAJE);
          expect(mensaje).not.toContain(recortado);
        },
      ),
    );
  });

  it("propiedad: con diez o más caracteres distintos y el largo suficiente se acepta", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
          {
            minLength: CARACTERES_DISTINTOS_MINIMOS,
            maxLength: 40,
          },
        ),
        fc.integer({ min: 0, max: 40 }),
        (alfabeto, extra) => {
          const secreto = [
            ...alfabeto,
            ..."x".repeat(Math.max(0, 32 - alfabeto.length)),
            ..."y".repeat(extra),
          ].join("");
          expect(leerSecretoDeAutenticacion(secreto)).toBe(secreto);
        },
      ),
    );
  });

  it("la prueba de variedad viene después del largo: uno corto dice que es corto", () => {
    expect(() => leerSecretoDeAutenticacion("a".repeat(5))).toThrow(
      "necesita al menos 32 caracteres",
    );
  });
});

describe("leerClienteDeGoogle", () => {
  it("devuelve el cliente sin blancos en los extremos", () => {
    expect(leerClienteDeGoogle("  id-de-prueba ", "\tsecreto-de-prueba\n")).toEqual({
      clientId: "id-de-prueba",
      clientSecret: "secreto-de-prueba",
    });
  });

  it("si falta el id, nombra solo el id", () => {
    expect(() => leerClienteDeGoogle(undefined, CENTINELA)).toThrow(
      new ErrorDeConfiguracion("GOOGLE_CLIENT_ID inválido: falta"),
    );
    expect(() => leerClienteDeGoogle("  ", CENTINELA)).toThrow(
      /^GOOGLE_CLIENT_ID inválido: falta$/,
    );
  });

  it("si falta el secreto, nombra solo el secreto", () => {
    expect(() => leerClienteDeGoogle(CENTINELA, undefined)).toThrow(
      new ErrorDeConfiguracion("GOOGLE_CLIENT_SECRET inválido: falta"),
    );
    expect(() => leerClienteDeGoogle(CENTINELA, "")).toThrow(
      /^GOOGLE_CLIENT_SECRET inválido: falta$/,
    );
  });

  it("si faltan los dos, los nombra a los dos, y nunca repite un valor", () => {
    let error: unknown;
    try {
      leerClienteDeGoogle("", "  ");
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toBe("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET inválido: falta");
  });
});

describe("leerClienteDeGoogleDePlataforma", () => {
  const ID = "cliente-de-la-consola";
  const SECRETO = "clave-de-la-consola";
  const WEB = { clientId: "cliente-de-la-web", clientSecret: "clave-de-la-web" };

  /** El mensaje del error, o `null` si no falló. */
  const mensajeDe = (accion: () => unknown): string | null => {
    try {
      accion();
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeConfiguracion);
      return (error as Error).message;
    }
    return null;
  };

  it("devuelve el cliente sin blancos en los extremos, con o sin el de la web a la vista", () => {
    const esperado = { clientId: ID, clientSecret: SECRETO };
    expect(leerClienteDeGoogleDePlataforma(`  ${ID} `, `\t${SECRETO}\n`)).toEqual(esperado);
    expect(leerClienteDeGoogleDePlataforma(ID, SECRETO, WEB)).toEqual(esperado);
    expect(
      leerClienteDeGoogleDePlataforma(ID, SECRETO, {
        clientId: undefined,
        clientSecret: undefined,
      }),
    ).toEqual(esperado);
    expect(
      leerClienteDeGoogleDePlataforma(ID, SECRETO, { clientId: "", clientSecret: "  " }),
    ).toEqual(esperado);
  });

  it("la misma exigencia que el de la web: si falta el id, el secreto o los dos, nombra las variables de la CONSOLA", () => {
    expect(mensajeDe(() => leerClienteDeGoogleDePlataforma(undefined, SECRETO))).toBe(
      "GOOGLE_CLIENT_ID_PLATAFORMA inválido: falta",
    );
    expect(mensajeDe(() => leerClienteDeGoogleDePlataforma("  ", SECRETO))).toBe(
      "GOOGLE_CLIENT_ID_PLATAFORMA inválido: falta",
    );
    expect(mensajeDe(() => leerClienteDeGoogleDePlataforma(ID, undefined))).toBe(
      "GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: falta",
    );
    expect(mensajeDe(() => leerClienteDeGoogleDePlataforma(ID, ""))).toBe(
      "GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: falta",
    );
    expect(mensajeDe(() => leerClienteDeGoogleDePlataforma("", "  "))).toBe(
      "GOOGLE_CLIENT_ID_PLATAFORMA, GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: falta",
    );
  });

  it("falta primero: sin id no se compara con el de la web", () => {
    expect(
      mensajeDe(() =>
        leerClienteDeGoogleDePlataforma("", SECRETO, { ...WEB, clientSecret: SECRETO }),
      ),
    ).toBe("GOOGLE_CLIENT_ID_PLATAFORMA inválido: falta");
  });

  it("el id de la consola igual al de la web: falla y nombra las dos variables, no el valor", () => {
    const mensaje = mensajeDe(() =>
      leerClienteDeGoogleDePlataforma(CENTINELA, SECRETO, { ...WEB, clientId: CENTINELA }),
    );
    expect(mensaje).toBe(
      "GOOGLE_CLIENT_ID_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_ID",
    );
    expect(mensaje).not.toContain(CENTINELA);
  });

  it("el secreto de la consola igual al de la web: falla y nombra las dos variables, no el valor", () => {
    const mensaje = mensajeDe(() =>
      leerClienteDeGoogleDePlataforma(ID, CENTINELA, { ...WEB, clientSecret: CENTINELA }),
    );
    expect(mensaje).toBe(
      "GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_SECRET",
    );
    expect(mensaje).not.toContain(CENTINELA);
  });

  it("si los dos son iguales, los nombra a los dos; los blancos de los extremos no los distinguen", () => {
    const mensaje = mensajeDe(() =>
      leerClienteDeGoogleDePlataforma(`  ${CENTINELA}`, `${CENTINELA}\n`, {
        clientId: `${CENTINELA}  `,
        clientSecret: `\t${CENTINELA}`,
      }),
    );
    expect(mensaje).toBe(
      "GOOGLE_CLIENT_ID_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_ID; GOOGLE_CLIENT_SECRET_PLATAFORMA inválido: no puede ser igual a GOOGLE_CLIENT_SECRET",
    );
    expect(mensaje).not.toContain(CENTINELA);
  });

  it("cruzar el id de una con el secreto de la otra no es lo mismo: solo se compara id con id y secreto con secreto", () => {
    expect(
      leerClienteDeGoogleDePlataforma(ID, SECRETO, { clientId: SECRETO, clientSecret: ID }),
    ).toEqual({ clientId: ID, clientSecret: SECRETO });
  });
});

describe("leerHostDeLaConsola", () => {
  const NOMBRE = "PEDERNAL_HOST_DE_LA_CONSOLA";

  it.each([
    "platform.pedernal.test",
    "consola.pedernal.test",
    "localhost:3000",
    "a.b.c.example.test",
  ])("acepta %s y lo devuelve tal cual", (host) => {
    expect(leerHostDeLaConsola(host)).toBe(host);
  });

  it("quita los blancos de los extremos", () => {
    expect(leerHostDeLaConsola("  platform.pedernal.test\n")).toBe("platform.pedernal.test");
  });

  it.each([undefined, "", "   ", "\n"])("falta (%j): el mensaje nombra la variable", (valor) => {
    expect(() => leerHostDeLaConsola(valor)).toThrow(
      new ErrorDeConfiguracion(`${NOMBRE} inválido: falta`),
    );
  });

  it.each([
    ["con esquema", "https://platform.pedernal.test"],
    ["con ruta", "platform.pedernal.test/ingreso"],
    ["con credenciales", "usuario@platform.pedernal.test"],
    ["con mayúsculas", "Platform.Pedernal.test"],
    ["con punto final", "platform.pedernal.test."],
    ["con espacios adentro", "platform pedernal.test"],
    ["una dirección IP", "192.0.2.10"],
    ["con un puerto fuera de rango", "platform.pedernal.test:70000"],
    ["con una etiqueta que empieza con guion", "-platform.pedernal.test"],
    ["una lista de hosts", "platform.pedernal.test,otro.pedernal.test"],
  ])("rechaza un host %s y no repite el valor", (_cual, valor) => {
    let mensaje: string | null = null;
    try {
      leerHostDeLaConsola(valor);
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeConfiguracion);
      mensaje = (error as Error).message;
    }
    expect(mensaje).toBe(
      `${NOMBRE} inválido: tiene que ser un nombre de host en minúsculas, sin esquema ni ruta`,
    );
    expect(mensaje).not.toContain(valor.trim());
  });
});
