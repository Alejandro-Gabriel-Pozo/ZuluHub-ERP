import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  describirFallaDeBase,
  fragmentosSecretos,
  ocultarSecretos,
} from "./describir-falla-de-base";
import { ErrorDeMigracion } from "./migraciones";

// Cadena inventada para las pruebas (no es de ninguna base): contraseña con caracteres que se codifican.
const CADENA =
  "postgresql://dueno_zz:p%40ss%3Aw%2Frd-9@ep-fria-luna-123456.sa-east-1.aws.ejemplo.tech/base_zz?sslmode=require";
const CLAVE = "p@ss:w/rd-9";

/** Un error como los de `pg` / Node: con código y sin pila relevante. */
function conCodigo(mensaje: string, code: string, extra: Record<string, string> = {}): Error {
  return Object.assign(new Error(mensaje), { code, ...extra });
}

describe("fragmentosSecretos", () => {
  it("sin cadena no hay nada que tapar", () => {
    expect(fragmentosSecretos(undefined)).toEqual([]);
  });

  it("junta la cadena, la contraseña (cruda y decodificada), el usuario, el host y su primera etiqueta", () => {
    const f = fragmentosSecretos(CADENA);
    expect(f).toEqual(expect.arrayContaining([CADENA, CLAVE, "p%40ss%3Aw%2Frd-9", "dueno_zz"]));
    expect(f).toEqual(
      expect.arrayContaining([
        "ep-fria-luna-123456.sa-east-1.aws.ejemplo.tech",
        "ep-fria-luna-123456",
      ]),
    );
  });

  it("va del más largo al más corto (tapar primero la cadena entera, no un pedazo)", () => {
    const f = fragmentosSecretos(CADENA);
    expect(f[0]).toBe(CADENA);
    for (let i = 1; i < f.length; i += 1) {
      expect((f[i - 1] as string).length).toBeGreaterThanOrEqual((f[i] as string).length);
    }
  });

  it("una cadena que no es URL se tapa entera y nada más", () => {
    expect(fragmentosSecretos("esto no es una url")).toEqual(["esto no es una url"]);
  });

  it("la cadena entera y la contraseña se tapan desde 3 caracteres; usuario y host, solo desde 8", () => {
    expect(fragmentosSecretos("postgres://ab:xyz@h/b")).toEqual(
      expect.arrayContaining(["postgres://ab:xyz@h/b", "xyz"]),
    );
    expect(fragmentosSecretos("postgres://ab:xyz@h/b")).not.toContain("ab");
    expect(fragmentosSecretos("postgres://ab:xyz@h/b")).not.toContain("h");
    const g = fragmentosSecretos("postgres://usuario8:clave123@host-largo.ejemplo/b");
    expect(g).toEqual(expect.arrayContaining(["usuario8", "clave123", "host-largo.ejemplo"]));
    const corto = fragmentosSecretos("postgres://usuar7:clave12@host-l.ejemplo/b");
    expect(corto).not.toContain("usuar7");
    expect(corto).not.toContain("host-l");
    expect(corto).toContain("clave12");
    expect(corto).toContain("host-l.ejemplo");
    expect(fragmentosSecretos("abc")).toEqual(["abc"]);
    expect(fragmentosSecretos("ab")).toEqual([]);
  });

  it("una cadena que no es URL y viene con espacios o salto de línea se tapa también sin ellos", () => {
    expect(fragmentosSecretos("  esto no es una url \n")).toContain("esto no es una url");
  });

  it("ignora los espacios de los extremos (un secreto pegado con salto de línea)", () => {
    expect(fragmentosSecretos(`  ${CADENA}\n`)).toEqual(expect.arrayContaining([CADENA, CLAVE]));
  });

  it("una contraseña con un % suelto (no decodificable) se tapa tal cual", () => {
    expect(fragmentosSecretos("postgres://usuario:cla%ve-larga@host-x.ejemplo/b")).toEqual(
      expect.arrayContaining(["cla%ve-larga"]),
    );
  });
});

describe("ocultarSecretos", () => {
  it("tapa cada pedazo de la cadena donde aparezca, todas las veces", () => {
    const texto = `fallo ${CADENA} con dueno_zz y ${CLAVE} y ep-fria-luna-123456.sa-east-1.aws.ejemplo.tech; otra vez dueno_zz`;
    const salida = ocultarSecretos(texto, CADENA);
    for (const secreto of [CADENA, "dueno_zz", CLAVE, "ep-fria-luna-123456", "p%40ss"]) {
      expect(salida).not.toContain(secreto);
    }
    expect(salida).toBe("fallo *** con *** y *** y ***; otra vez ***");
  });

  it("deja el texto como está si no hay cadena", () => {
    expect(ocultarSecretos("sin secretos acá", undefined)).toBe("sin secretos acá");
  });
});

/**
 * Forma de la cadena de las pruebas de integración (valores inventados, no de ninguna base): host por IP, rol `pedernal_*`, contraseña de
 * 36 hexadecimales. Antes el tramo `127` (primera etiqueta del host) tapaba medio UUID de la salida de los scripts, y la prueba de
 * `ejecutar-caso-de-plataforma` fallaba una de cada tantas corridas.
 */
describe("ocultarSecretos: no tapa fragmentos cortos pero sí todo secreto", () => {
  const CLAVE_DE_PRUEBAS = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b";
  const DE_PRUEBAS = `postgresql://pedernal_plataforma:${CLAVE_DE_PRUEBAS}@127.0.0.1:55432/pedernal_it_ab12cd34ef56`;

  it("un UUID que contiene el tramo corto `127` sale intacto", () => {
    const uuid = "7127a3c1-0127-4127-8127-127127127127";
    expect(ocultarSecretos(`empresaId: ${uuid}`, DE_PRUEBAS)).toBe(`empresaId: ${uuid}`);
  });

  // Contraseña corta de prueba con letras que un UUID (solo hexadecimales) no puede contener.
  const CON_CLAVE_CORTA =
    "postgresql://pedernal_plataforma:zq7Xy9@127.0.0.1:55432/pedernal_it_ab12cd34ef56";

  it.each([DE_PRUEBAS, CON_CLAVE_CORTA])(
    "ningún UUID sale tapado con la cadena de pruebas, de clave larga o corta (propiedad)",
    (cadena) => {
      fc.assert(
        fc.property(
          fc.uuid(),
          (uuid) => ocultarSecretos(`empresaId: ${uuid}`, cadena) === `empresaId: ${uuid}`,
        ),
        { numRuns: 2000 },
      );
    },
  );

  it("la cadena entera y sus tramos largos (clave, usuario, host con 8 o más) se tapan donde aparezcan", () => {
    expect(ocultarSecretos(`x ${DE_PRUEBAS} y`, DE_PRUEBAS)).toBe("x *** y");
    expect(ocultarSecretos(`clave=${CLAVE_DE_PRUEBAS}`, DE_PRUEBAS)).toBe("clave=***");
    expect(ocultarSecretos("rol pedernal_plataforma", DE_PRUEBAS)).toBe("rol ***");
    expect(ocultarSecretos("en ep-fria-luna-123456.sa-east-1.aws.ejemplo.tech", CADENA)).toBe(
      "en ***",
    );
  });

  it("un usuario con caracteres codificados se tapa tanto crudo como decodificado", () => {
    const cadena = "postgresql://due%C3%B1o_zzz:clave-larga-1@servidor-x.ejemplo/b";
    expect(ocultarSecretos("a due%C3%B1o_zzz b dueño_zzz c", cadena)).toBe("a *** b *** c");
  });

  it("usuario con exactamente 8 caracteres se tapa y con 7 no (borde del mínimo de los tramos)", () => {
    const cadena = "postgresql://abcdefgh:clave-larga-1@servidor-x.ejemplo/b";
    expect(ocultarSecretos("abcdefgh abcdefg", cadena)).toBe("*** abcdefg");
  });

  it("una contraseña corta (6) y una con especiales (decodificada) se tapan; `127` y fragmentos de UUID, no", () => {
    const corta = "postgresql://pedernal_app:ab3Xy9@127.0.0.1:5432/b";
    expect(ocultarSecretos("clave ab3Xy9 y 127 y 7127a3c1", corta)).toBe(
      "clave *** y 127 y 7127a3c1",
    );
    const rara = "postgresql://pedernal_app:p%40s%3Ax@127.0.0.1:5432/b";
    expect(ocultarSecretos("clave p@s:x y p%40s%3Ax", rara)).toBe("clave *** y ***");
  });

  it("un secreto declarado sin forma de URL (token, clave) se tapa entero aunque sea corto", () => {
    expect(ocultarSecretos("token abc12 fin", "abc12")).toBe("token *** fin");
    expect(ocultarSecretos("token abc12 fin", "abc12\n")).toBe("token *** fin");
  });
});

describe("describirFallaDeBase", () => {
  const sinSecretos = (texto: string) => {
    for (const secreto of [CADENA, "dueno_zz", CLAVE, "ep-fria-luna-123456", "ejemplo.tech"]) {
      expect(texto).not.toContain(secreto);
    }
  };

  it("el rechazo del pooler se explica con su mensaje propio", () => {
    const texto = describirFallaDeBase(
      new ErrorDeMigracion("la cadena apunta al pooler: usá la cadena directa"),
      CADENA,
    );
    expect(texto).toBe("la cadena apunta al pooler: usá la cadena directa");
  });

  it("un error de migración que repitiera la cadena sale tapado", () => {
    const texto = describirFallaDeBase(new ErrorDeMigracion(`falló con ${CADENA}`), CADENA);
    expect(texto).toBe("falló con ***");
  });

  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ])(
    "una falla de red (%s) se cuenta por su código, sin repetir el mensaje (que trae el host)",
    (code) => {
      const texto = describirFallaDeBase(
        conCodigo(`connect ${code} ep-fria-luna-123456.sa-east-1.aws.ejemplo.tech:5432`, code),
        CADENA,
      );
      expect(texto).toContain(`(${code})`);
      expect(texto).toContain(
        "no se pudo conectar con el servidor de la base (" +
          code +
          "): revisá que la cadena guardada como secreto sea la correcta y que la base esté activa",
      );
      sinSecretos(texto);
      expect(texto).not.toContain("5432");
    },
  );

  it.each([
    ["28P01", "la base rechazó el usuario o la contraseña"],
    ["28000", "la base rechazó el usuario o la contraseña"],
    ["3D000", "la base que nombra la cadena de conexión no existe"],
    ["57P03", "la base no aceptó la conexión en este momento"],
    ["53300", "ya hay demasiadas conexiones abiertas"],
  ])("la falla de conexión SQLSTATE %s se cuenta con texto propio", (code, esperado) => {
    const texto = describirFallaDeBase(
      conCodigo(`password authentication failed for user "dueno_zz"`, code),
      CADENA,
    );
    expect(texto).toContain(esperado);
    expect(texto).toContain(`(${code})`);
    sinSecretos(texto);
  });

  it("una URL inválida no repite lo que llegó", () => {
    const texto = describirFallaDeBase(
      conCodigo(`Invalid URL ${CADENA}`, "ERR_INVALID_URL"),
      CADENA,
    );
    expect(texto).toBe("la cadena de conexión no tiene un formato válido");
  });

  it("el error de una migración (RAISE EXCEPTION) se muestra completo, con su código, detalle y pista", () => {
    const texto = describirFallaDeBase(
      conCodigo(
        "los roles de Pedernal no pueden ser miembros de otros roles (pedernal_app es miembro de neon_superuser): revocar la pertenencia y repetir",
        "55000",
        { detail: "lo que pasó", hint: "lo que hay que hacer" },
      ),
      CADENA,
    );
    expect(texto).toBe(
      "Error: los roles de Pedernal no pueden ser miembros de otros roles (pedernal_app es miembro de neon_superuser): revocar la pertenencia y repetir detalle: lo que pasó pista: lo que hay que hacer [55000]",
    );
  });

  it("un error de la base (que `pg` llama «error») se muestra sin ese prefijo", () => {
    const deLaBase = Object.assign(new Error("el rol no existe"), { name: "error", code: "42704" });
    expect(describirFallaDeBase(deLaBase, CADENA)).toBe("el rol no existe [42704]");
  });

  it("sin detalle, pista ni código, solo nombre y mensaje", () => {
    expect(describirFallaDeBase(new TypeError("algo raro"), CADENA)).toBe("TypeError: algo raro");
    expect(
      describirFallaDeBase(Object.assign(new Error("x"), { detail: "", hint: undefined }), CADENA),
    ).toBe("Error: x");
    expect(
      describirFallaDeBase(Object.assign(new Error("x"), { detail: undefined, hint: "" }), CADENA),
    ).toBe("Error: x");
  });

  it("un error de migración que menciona al usuario o a la contraseña sale tapado", () => {
    const texto = describirFallaDeBase(
      conCodigo(`el rol "dueno_zz" no puede ${CLAVE}`, "42501", { detail: "rol dueno_zz" }),
      CADENA,
    );
    sinSecretos(texto);
    expect(texto).toBe('Error: el rol "***" no puede *** detalle: rol *** [42501]');
  });

  it("lo que no es un Error no se vuelca", () => {
    expect(describirFallaDeBase(CADENA, CADENA)).toBe("falla inesperada que no es un Error");
    expect(describirFallaDeBase({ cadena: CADENA }, CADENA)).toBe(
      "falla inesperada que no es un Error",
    );
  });
});
