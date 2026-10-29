import { describe, expect, expectTypeOf, it } from "vitest";
import { campoConPosibleSecreto, type Dato } from "../../puertos/sin-secretos";
import type { EstadoEfectivo } from "../../contexto/estados";
import type { MotivoDeRechazo } from "../permisos/guard";
import type { RolDeEmpresa } from "../permisos/roles";
import { CLAVES_DE_ERRORES_FISCALES } from "../experiencia/respuesta-fiscal";
import {
  CATALOGO_DE_TEXTOS,
  LARGO_MAXIMO_DE_TEXTO,
  type ClaveDeTexto,
  type DefinicionDeTexto,
} from "./catalogo";

/**
 * El catálogo de textos por defecto (marcas y planes, §B.4 y §D «Vocabulario»). Las reglas de forma son
 * las que después aplica `validarVocabulario` a los reemplazos de una marca y que la base repite como
 * defensa en profundidad: se fijan acá desde el primer texto.
 */

const FORMATO_DE_CLAVE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$/;
const MARCADOR = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const LARGO_MAXIMO_ABSOLUTO = 200;

const entradas = Object.entries(CATALOGO_DE_TEXTOS) as [ClaveDeTexto, DefinicionDeTexto][];

const marcadoresDe = (texto: string): string[] =>
  [...texto.matchAll(MARCADOR)].map((m) => m[1] ?? "").sort();

describe("el catálogo de textos: forma de cada clave y de cada texto", () => {
  it("no está vacío", () => {
    expect(entradas.length).toBeGreaterThan(0);
  });

  it.each(entradas)(
    "%s: clave bien formada, con prefijo del módulo dueño o transversal",
    (clave) => {
      expect(clave).toMatch(FORMATO_DE_CLAVE);
      expect(clave.length).toBeLessThanOrEqual(80);
    },
  );

  it.each(entradas)(
    "%s: texto por defecto no vacío, recortado, NFC y sin caracteres peligrosos",
    (_c, d) => {
      expect(d.porDefecto.length).toBeGreaterThan(0);
      expect(d.porDefecto).toBe(d.porDefecto.trim());
      expect(d.porDefecto).toBe(d.porDefecto.normalize("NFC"));
      // Ni control (\p{Cc}) ni formato (\p{Cf}: ancho cero, marcas bidireccionales), ni `<` ni `>`.
      expect(d.porDefecto).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(d.porDefecto).not.toMatch(/[<>]/);
    },
  );

  it.each(entradas)(
    "%s: el texto entra en su largo máximo, que no pasa el tope de la base",
    (_c, d) => {
      const maximo = d.largoMaximo ?? LARGO_MAXIMO_DE_TEXTO;
      expect(maximo).toBeGreaterThan(0);
      expect(maximo).toBeLessThanOrEqual(LARGO_MAXIMO_ABSOLUTO);
      expect([...d.porDefecto].length).toBeLessThanOrEqual(maximo);
    },
  );

  it.each(entradas)(
    "%s: los marcadores declarados son exactamente los que usa el texto",
    (_c, d) => {
      expect(marcadoresDe(d.porDefecto)).toEqual([...(d.marcadores ?? [])].sort());
    },
  );

  it("el largo máximo por defecto es 80", () => {
    expect(LARGO_MAXIMO_DE_TEXTO).toBe(80);
  });

  it("ninguna clave parece un secreto por su nombre (NOMBRE_DE_SECRETO): así se audita sin riesgo", () => {
    const comoCampos: Record<string, Dato> = Object.fromEntries(entradas.map(([c]) => [c, 1]));
    expect(campoConPosibleSecreto(comoCampos)).toBeNull();
  });

  it("hay un solo texto por clave y todas son distintas sin importar mayúsculas", () => {
    const claves = entradas.map(([c]) => c.toLowerCase());
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("el catálogo de textos: lo que tiene que traer hoy", () => {
  const claves = entradas.map(([c]) => c);

  it("las claves de administración y los roles fijos de empresa", () => {
    expect(claves).toEqual(
      expect.arrayContaining([
        "modulo.administracion.nombre",
        "rol.gerente.nombre",
        "rol.administrador.nombre",
        "rol.operador.nombre",
      ]),
    );
  });

  it("un texto por cada rol de empresa y por cada motivo del guard, exactamente (el tipo lo verifica)", () => {
    expectTypeOf<
      Extract<ClaveDeTexto, `rol.${string}`>
    >().toEqualTypeOf<`rol.${Lowercase<RolDeEmpresa>}.nombre`>();
    expectTypeOf<Extract<ClaveDeTexto, `motivo.${string}`>>().toEqualTypeOf<
      | `motivo.${Lowercase<MotivoDeRechazo>}`
      // W5: el estado de una empresa que no opera (`motivo.empresa.<estado>`, [01] §6.3), uno por estado.
      | `motivo.empresa.${Lowercase<Exclude<EstadoEfectivo, "OPERA">>}`
    >();
    expect(
      claves.filter((c) => c.startsWith("motivo.") && !c.startsWith("motivo.empresa.")),
    ).toHaveLength(5);
    expect(claves.filter((c) => c.startsWith("motivo.empresa."))).toHaveLength(5);
    expect(claves.filter((c) => c.startsWith("rol."))).toHaveLength(3);
  });

  it("los errores nuevos que ve una empresa o la puerta de entrada", () => {
    expect(
      claves.filter((c) => c.startsWith("error.") && !c.startsWith("error.fiscal_")).sort(),
    ).toEqual(
      [
        "error.empresa_de_otra_marca",
        "error.funcion_no_incluida",
        "error.inesperado",
        "error.invitacion_de_otra_marca",
        "error.limite_del_plan",
        "error.referencia",
        // W5: uno por código público de `experiencia/respuesta.ts` (lo comprueba su prueba de contrato).
        "error.sesion_vencida",
        "error.no_disponible",
        "error.invitacion_no_encontrada",
        "error.invitacion_revocada",
        "error.invitacion_no_pendiente",
        "error.invitacion_vencida",
        "error.invitacion_de_otro_email",
        "error.alta_no_pendiente",
        "error.persona_suspendida",
        "error.persona_de_otro_usuario",
        "error.usuario_de_otra_persona",
        "error.ya_es_miembro",
        "error.rol_distinto_al_anterior",
        "error.empresa_no_opera",
      ].sort(),
    );
  });

  it("los errores del facturador son exactamente los códigos fiscales, y lo de ARCA sale traducido con su código como marcador", () => {
    expect(claves.filter((c) => c.startsWith("error.fiscal_")).sort()).toEqual(
      Object.values(CLAVES_DE_ERRORES_FISCALES).sort(),
    );
    for (const generico of ["error_generico", "observacion_generica", "evento_generico"] as const) {
      expect(CATALOGO_DE_TEXTOS[`fiscal.arca.${generico}`].marcadores).toEqual(["codigo"]);
    }
    // Nada del facturador habla en voseo: los textos de ARCA y de los errores van en castellano neutro. Salvo los dos del
    // listado que el dueño aprobó tal cual (CONTRATO del listado: «Probá con otro período…» y «Probá de nuevo.»).
    const APROBADOS_EN_VOSEO = ["fiscal.pantalla.listado_vacio", "fiscal.pantalla.listado_error"];
    for (const clave of claves.filter(
      (c) =>
        (c.startsWith("error.fiscal_") || c.startsWith("fiscal.")) &&
        !APROBADOS_EN_VOSEO.includes(c),
    )) {
      expect(CATALOGO_DE_TEXTOS[clave].porDefecto, clave).not.toMatch(
        /\b(podés|tenés|revisá|probá|volvé|esperá|cargalo|activalo|consultá)\b/i,
      );
    }
  });

  it("los textos de la pantalla de detalle del facturador: los siete estados (D-25), la anulación (D-29) y sin «acreditad»", () => {
    const pantalla = claves.filter((c) => c.startsWith("fiscal.pantalla."));
    expect(pantalla.length).toBeGreaterThan(0);
    const estados = (Object.entries(CATALOGO_DE_TEXTOS) as [ClaveDeTexto, DefinicionDeTexto][])
      .filter(([c]) => c.startsWith("fiscal.pantalla.estado_"))
      .map(([c, d]) => [c, d.porDefecto]);
    expect(Object.fromEntries(estados)).toEqual({
      "fiscal.pantalla.estado_pendiente": "Pendiente de enviar",
      "fiscal.pantalla.estado_en_validacion": "Validando",
      "fiscal.pantalla.estado_autorizado": "Autorizada",
      "fiscal.pantalla.estado_rechazado": "Rechazada",
      "fiscal.pantalla.estado_incierto": "Confirmando",
      "fiscal.pantalla.estado_conflicto": "Requiere revisión",
      "fiscal.pantalla.estado_descartado": "Descartada",
    });
    expect(CATALOGO_DE_TEXTOS["fiscal.pantalla.anulacion_parcial"].porDefecto).toBe(
      "Anulación parcial",
    );
    expect(CATALOGO_DE_TEXTOS["fiscal.pantalla.anulacion_total"].porDefecto).toBe(
      "Anulación total",
    );
    expect(CATALOGO_DE_TEXTOS["fiscal.pantalla.ya_anulado"].porDefecto).toBe(
      "Ya anulado con notas de crédito",
    );
    for (const clave of pantalla) {
      expect(CATALOGO_DE_TEXTOS[clave].porDefecto, clave).not.toMatch(/acreditad/i);
    }
    expect(CATALOGO_DE_TEXTOS["error.fiscal_comprobante_no_encontrado"].porDefecto).toBe(
      "No encontramos ese comprobante.",
    );
  });

  it("los textos de los errores con datos declaran su marcador", () => {
    expect(CATALOGO_DE_TEXTOS["error.limite_del_plan"].marcadores).toEqual(["limite"]);
    expect(CATALOGO_DE_TEXTOS["error.limite_del_plan"].porDefecto).toContain("{limite}");
  });

  it("los textos de la interfaz base: conexión, envío y sesión (W2), exactamente", () => {
    expect(claves.filter((c) => /^(conexion|sesion)\./.test(c)).sort()).toEqual([
      "conexion.enviando",
      "conexion.no_se_puede_enviar",
      "conexion.sin_conexion",
      "conexion.verificando",
      "sesion.aviso_detalle",
      "sesion.aviso_titulo",
      "sesion.estado_activa",
      "sesion.estado_por_vencer",
      "sesion.estado_vencida",
      "sesion.ingresar_de_nuevo",
      "sesion.seguir",
      "sesion.vencida_detalle",
      "sesion.vencida_titulo",
    ]);
    expect(CATALOGO_DE_TEXTOS["sesion.aviso_titulo"].porDefecto).toBe("¿Seguís ahí?");
    expect(CATALOGO_DE_TEXTOS["conexion.verificando"].porDefecto).toBe(
      "Verificando si se registró…",
    );
  });

  it("la referencia del error inesperado lleva su marcador", () => {
    expect(CATALOGO_DE_TEXTOS["error.referencia"].marcadores).toEqual(["referencia"]);
    expect(CATALOGO_DE_TEXTOS["error.referencia"].porDefecto).toContain("{referencia}");
  });

  it("el motivo de solo lectura dice que lo cargado se conserva (decisión de bajas de plan)", () => {
    expect(CATALOGO_DE_TEXTOS["motivo.modulo_en_solo_lectura"].porDefecto).toMatch(/conserva/);
  });

  it("una clave que el catálogo no tiene no compila", () => {
    // @ts-expect-error esa clave no está en el catálogo
    const inventada: ClaveDeTexto = "reservas.estadia.singular";
    expect(inventada in CATALOGO_DE_TEXTOS).toBe(false);
  });
});
