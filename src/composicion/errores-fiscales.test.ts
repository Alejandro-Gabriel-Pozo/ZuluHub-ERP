import { describe, expect, it } from "vitest";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";
import { CATALOGO_DE_TEXTOS } from "../capacidades/vocabulario/catalogo";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  CODIGOS_DE_CONFIGURACION_SIN_TEXTO,
  FISCAL_POR_ERROR_CON_CODIGO,
  FISCAL_POR_ERROR_DE_TEXTO,
  aRespuestaFiscal,
  traducirErrorFiscal,
  traducirMensajeDeArca,
} from "./errores-fiscales";

/**
 * El traductor de los errores del facturador (ADR-016). Lo que más importa: (1) todo error de negocio de fiscal sale
 * con un código público que tiene su texto, (2) nada interno llega a la pantalla (ni el nombre de una restricción, ni un
 * SQLSTATE, ni el texto crudo de ARCA) y (3) el motivo del guard (`SIN_PERMISO`) pasa tal cual. Que no quede un error
 * del módulo sin traducir lo exige el compilador (las tablas son `Record` sobre la unión de errores).
 */

/** Los códigos públicos de una tabla: sin los defectos (`null`) ni los que todavía no tienen texto aprobado. */
const conCodigoPublico = (valores: readonly (string | null)[]): CodigoFiscal[] =>
  valores.filter((c): c is CodigoFiscal => c !== null && c !== "SIN_TEXTO_APROBADO");

const registrados: string[] = [];
const dependencias = {
  registrar: (detalle: string) => registrados.push(detalle),
  azar: () => new Uint8Array([1, 2, 3, 4]),
};

describe("las tablas de traducción", () => {
  it("cada error de negocio traducido apunta a un código público fiscal con su texto en el catálogo", () => {
    const codigos = [
      ...conCodigoPublico(Object.values(FISCAL_POR_ERROR_DE_TEXTO)),
      ...Object.values(FISCAL_POR_ERROR_CON_CODIGO),
    ];
    expect(codigos.length).toBeGreaterThan(40);
    for (const codigo of codigos) {
      expect(codigo).toMatch(/^FISCAL_[A-Z_]+$/);
      expect(CODIGOS_PUBLICOS[codigo].presentacion).toBe("AVISO");
      expect(Object.hasOwn(CATALOGO_DE_TEXTOS, CODIGOS_PUBLICOS[codigo].clave)).toBe(true);
    }
  });

  it("los únicos defectos (sin código público) son los que vienen de una restricción de la base", () => {
    const defectos = Object.entries(FISCAL_POR_ERROR_DE_TEXTO)
      .filter(([, codigo]) => codigo === null)
      .map(([error]) => error)
      .sort();
    expect(defectos).toEqual([
      "COMPROBANTE_ALTA_INVALIDA",
      "COMPROBANTE_ASOCIADO_INVALIDO",
      // Configuración fiscal: Ingresos Brutos no lo puede provocar nadie (D-45), la base no repite el número de versión, y una
      // sucursal ajena es un pedido armado a mano (sin oráculo).
      "IIBB_CONDICION_INVALIDA",
      "IIBB_NUMERO_INVALIDO",
      "NUMERO_DE_VERSION_INVALIDO",
      "SUCURSAL_DE_OTRA_EMPRESA",
    ]);
  });

  it("todo código fiscal público lo usa algún error (ninguno queda sin camino)", () => {
    const usados = new Set<string>([
      ...conCodigoPublico(Object.values(FISCAL_POR_ERROR_DE_TEXTO)),
      ...Object.values(FISCAL_POR_ERROR_CON_CODIGO),
    ]);
    // Los que arma la entrada de la web y no el módulo (`entradas-de-facturacion.ts`).
    const delBorde = new Set(["FISCAL_DATOS_INVALIDOS"]);
    for (const codigo of Object.keys(CODIGOS_PUBLICOS).filter((c) => c.startsWith("FISCAL_"))) {
      expect(usados.has(codigo) || delBorde.has(codigo), codigo).toBe(true);
    }
  });
});

describe("la configuración fiscal (D-43)", () => {
  it("los errores de datos salen como datos inválidos con el campo del formulario", () => {
    const campos: Record<string, string> = {
      RAZON_SOCIAL_INVALIDA: "razonSocial",
      CONDICION_IVA_INVALIDA: "condicionIva",
      INICIO_DE_ACTIVIDADES_INVALIDO: "inicioActividades",
      CALLE_INVALIDA: "domicilio.calle",
      NUMERO_INVALIDO: "domicilio.numero",
      PISO_INVALIDO: "domicilio.piso",
      DEPARTAMENTO_INVALIDO: "domicilio.departamento",
      LOCALIDAD_INVALIDA: "domicilio.localidad",
      PROVINCIA_INVALIDA: "domicilio.provincia",
      CODIGO_POSTAL_INVALIDO: "domicilio.codigoPostal",
      PUNTO_DE_VENTA_NUMERO_INVALIDO: "numero",
      VIGENCIA_RETROACTIVA: "vigenteDesde",
      INSTANTE_INVALIDO: "vigenteDesde",
    };
    for (const [error, campo] of Object.entries(campos)) {
      expect(traducirErrorFiscal(error), error).toEqual({
        codigo: "FISCAL_DATOS_INVALIDOS",
        campo,
      });
    }
  });

  it("faltan datos obligatorios: apunta al primer campo que falta, con los nombres del formulario", () => {
    const faltan = (faltantes: string[]) =>
      traducirErrorFiscal({ codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes });
    expect(faltan(["razonSocial", "inicioActividades"])).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "razonSocial",
    });
    expect(faltan(["condicionIva"])).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "condicionIva",
    });
    expect(faltan(["domicilioFiscalId", "inicioActividades"])).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "domicilio",
    });
    expect(faltan(["inicioActividades"])).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "inicioActividades",
    });
    // Sin faltantes (no pasa: el dominio siempre informa uno): el código sin campo.
    expect(faltan([])).toEqual({ codigo: "FISCAL_DATOS_INVALIDOS" });
  });

  it("reusa lo ya aprobado: motivo obligatorio, identificador mal armado y versión desactualizada", () => {
    expect(traducirErrorFiscal("MOTIVO_OBLIGATORIO")).toEqual({
      codigo: "FISCAL_MOTIVO_INVALIDO",
      campo: "motivo",
    });
    expect(traducirErrorFiscal("ID_INVALIDO")).toEqual({ codigo: "FISCAL_PEDIDO_SIN_IDENTIFICAR" });
    expect(traducirErrorFiscal("VERSION_DESACTUALIZADA")).toEqual({
      codigo: "FISCAL_VERSION_DESACTUALIZADA",
    });
  });

  it("los códigos sin texto aprobado son estos nueve: salen sin cambios (inesperado con referencia) hasta que el dueño los apruebe", () => {
    expect([...CODIGOS_DE_CONFIGURACION_SIN_TEXTO].sort()).toEqual([
      "DATOS_FISCALES_NO_ENCONTRADOS",
      "DOMICILIO_NO_ENCONTRADO",
      "EMISOR_NO_ENCONTRADO",
      "ID_EN_USO",
      "PUNTO_DE_VENTA_DUPLICADO",
      "PUNTO_DE_VENTA_NUMERO_INMUTABLE",
      "PUNTO_DE_VENTA_SIN_DOMICILIO",
      "VERSION_CONFIRMADA_INMUTABLE",
      "YA_HAY_BORRADOR",
    ]);
    for (const error of CODIGOS_DE_CONFIGURACION_SIN_TEXTO) {
      expect(traducirErrorFiscal(error), error).toBe(error);
      const respuesta = aRespuestaFiscal(err(error), dependencias, () => null);
      expect(respuesta, error).toMatchObject({
        ok: false,
        error: { codigo: "ERROR_INTERNO", referencia: expect.stringMatching(/^PD-/) as string },
      });
    }
  });
});

describe("traducirErrorFiscal", () => {
  it("un error de texto pasa a su código", () => {
    expect(traducirErrorFiscal("SIN_CERTIFICADO_VIGENTE")).toEqual({
      codigo: "FISCAL_SIN_CERTIFICADO",
    });
  });

  it("los motivos del facturador llevan el campo `motivo`", () => {
    expect(traducirErrorFiscal("MOTIVO_DE_DESCARTE_INVALIDO")).toEqual({
      codigo: "FISCAL_MOTIVO_INVALIDO",
      campo: "motivo",
    });
    expect(traducirErrorFiscal({ codigo: "MOTIVO_INVALIDO" })).toEqual({
      codigo: "FISCAL_MOTIVO_INVALIDO",
      campo: "motivo",
    });
  });

  it("un renglón se señala con su posición base uno y el campo", () => {
    expect(
      traducirErrorFiscal({ codigo: "RENGLON_INVALIDO", posicion: 2, campo: "cantidad" }),
    ).toEqual({ codigo: "FISCAL_RENGLON_INVALIDO", campo: "renglon3.cantidad" });
    expect(traducirErrorFiscal({ codigo: "FALTA_ALICUOTA", posicion: 0 })).toEqual({
      codigo: "FISCAL_FALTA_ALICUOTA",
      campo: "renglon1.alicuota",
    });
    expect(traducirErrorFiscal({ codigo: "ALICUOTA_EN_LETRA_C", posicion: 4 })).toEqual({
      codigo: "FISCAL_ALICUOTA_EN_LETRA_C",
      campo: "renglon5.alicuota",
    });
  });

  it("un campo del receptor se señala como `receptor.<campo>`", () => {
    expect(traducirErrorFiscal({ codigo: "RECEPTOR_INVALIDO", campo: "documento" })).toEqual({
      codigo: "FISCAL_RECEPTOR_INVALIDO",
      campo: "receptor.documento",
    });
  });

  it("un criterio inválido del listado apunta al filtro", () => {
    expect(traducirErrorFiscal("CLAVE_DE_PAGINA_INVALIDA")).toEqual({
      codigo: "FISCAL_FILTRO_INVALIDO",
      campo: "despuesDe",
    });
  });

  it("un comprobante «de otra empresa» se dice igual que uno que no existe", () => {
    expect(traducirErrorFiscal({ codigo: "ASOCIADO_DE_OTRA_EMPRESA" })).toEqual(
      traducirErrorFiscal("COMPROBANTE_NO_ENCONTRADO"),
    );
  });

  it("el resultado de ARCA al resincronizar (SERVICIO_NO_DISPONIBLE...) se traduce y su detalle no viaja", () => {
    const traducido = traducirErrorFiscal({
      codigo: "SERVICIO_NO_DISPONIBLE",
      detalle: "no se pudieron obtener las credenciales del emisor",
    });
    expect(traducido).toEqual({ codigo: "FISCAL_ARCA_NO_DISPONIBLE" });
  });

  it.each([
    ["el motivo del guard", "SIN_PERMISO"],
    ["la empresa que no opera", { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" }],
    ["un error de persistencia", { tipo: "Unicidad", restriccion: "comprobante_origen_uk" }],
    ["un defecto del módulo", "COMPROBANTE_ALTA_INVALIDA"],
    ["un texto que nadie conoce", "ALGO_QUE_NO_EXISTE"],
    ["un nombre del prototipo", "constructor"],
    ["algo que no es un error", 42],
    ["nada", null],
  ])("%s pasa sin cambios", (_caso, error) => {
    expect(traducirErrorFiscal(error)).toBe(error);
  });
});

describe("aRespuestaFiscal", () => {
  it("el éxito sale presentado por quien llama", () => {
    expect(aRespuestaFiscal(ok({ id: "x", interno: "y" }), dependencias, (v) => v.id)).toEqual({
      ok: true,
      dato: "x",
    });
  });

  it("un error de negocio sale con su código y su texto, sin referencia ni registro", () => {
    registrados.length = 0;
    const r = aRespuestaFiscal(err("SERIE_BLOQUEADA"), dependencias, () => 0);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "FISCAL_SERIE_BLOQUEADA",
        clave: "error.fiscal_serie_bloqueada",
        presentacion: "AVISO",
      },
    });
    expect(registrados).toEqual([]);
  });

  it("SIN_PERMISO sale como motivo del guard (la pantalla oculta la acción por su código)", () => {
    const r = aRespuestaFiscal(err("SIN_PERMISO"), dependencias, () => 0);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO", presentacion: "POR_QUE_NO_PUEDO" },
    });
  });

  it.each([
    ["una restricción de la base", { tipo: "Unicidad", restriccion: "comprobante_origen_uk" }],
    ["un SQLSTATE", { tipo: "Inesperado", sqlstate: "40001", mensaje: "could not serialize" }],
    ["un defecto del módulo", "COMPROBANTE_ALTA_INVALIDA"],
    ["una excepción", new Error("connection to postgres://usuario:clave@host/base failed")],
  ])("%s sale como error inesperado con referencia y SIN detalle", (_caso, error) => {
    registrados.length = 0;
    const r = aRespuestaFiscal(err(error), dependencias, () => 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(r.error.referencia).toMatch(/^PD-/);
    const salida = JSON.stringify(r);
    for (const interno of [
      "comprobante_origen_uk",
      "40001",
      "serialize",
      "COMPROBANTE_ALTA",
      "postgres://",
      "clave@",
    ]) {
      expect(salida).not.toContain(interno);
    }
    // El detalle sí queda en el registro del servidor, con la misma referencia.
    expect(registrados).toHaveLength(1);
    expect(registrados[0]).toContain(r.error.referencia);
  });
});

describe("traducirMensajeDeArca: lo que ARCA contestó, sin su texto crudo", () => {
  const CRUDO = "Texto crudo de ARCA con el CUIT 20111111112 y la ruta /ws/internos";

  it("un código que el módulo conoce sale con su texto propio", () => {
    expect(traducirMensajeDeArca({ clase: "ERROR", codigo: 10013, texto: CRUDO })).toEqual({
      clase: "ERROR",
      codigo: 10013,
      clave: "fiscal.arca.receptor_para_a",
    });
    expect(traducirMensajeDeArca({ clase: "OBSERVACION", codigo: 10237, texto: CRUDO })).toEqual({
      clase: "OBSERVACION",
      codigo: 10237,
      clave: "fiscal.arca.nota_mayor_que_el_comprobante",
    });
  });

  it.each([
    [600, "fiscal.arca.autorizacion"],
    [601, "fiscal.arca.autorizacion"],
    [500, "fiscal.arca.problema_interno"],
    [502, "fiscal.arca.problema_interno"],
    [602, "fiscal.arca.sin_datos"],
    [10016, "fiscal.arca.fuera_de_secuencia"],
  ] as const)("el código %i se dice por su categoría", (codigo, clave) => {
    expect(traducirMensajeDeArca({ clase: "ERROR", codigo, texto: CRUDO })).toEqual({
      clase: "ERROR",
      codigo,
      clave,
    });
  });

  it.each([
    ["ERROR", "fiscal.arca.error_generico"],
    ["OBSERVACION", "fiscal.arca.observacion_generica"],
    ["EVENTO", "fiscal.arca.evento_generico"],
  ] as const)(
    "un código desconocido (%s) sale con el texto general y el código como marcador",
    (clase, clave) => {
      expect(traducirMensajeDeArca({ clase, codigo: 99999, texto: CRUDO })).toEqual({
        clase,
        codigo: 99999,
        clave,
        marcadores: { codigo: "99999" },
      });
    },
  );

  it("el texto crudo no sale nunca, y todo texto devuelto existe en el catálogo", () => {
    for (const codigo of [500, 600, 602, 10013, 10016, 10237, 10242, 99999]) {
      for (const clase of ["ERROR", "OBSERVACION", "EVENTO"] as const) {
        const salida = traducirMensajeDeArca({ clase, codigo, texto: CRUDO });
        expect(JSON.stringify(salida)).not.toContain("CUIT");
        expect(JSON.stringify(salida)).not.toContain("/ws/internos");
        expect(Object.hasOwn(CATALOGO_DE_TEXTOS, salida.clave)).toBe(true);
      }
    }
  });
});
