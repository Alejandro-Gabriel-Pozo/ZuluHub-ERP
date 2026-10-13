import { describe, expect, expectTypeOf, it } from "vitest";
import { campoConPosibleSecreto, type Dato } from "../../puertos/sin-secretos";
import type { MotivoDeRechazo } from "../permisos/guard";
import type { RolDeEmpresa } from "../permisos/roles";
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
    expectTypeOf<
      Extract<ClaveDeTexto, `motivo.${string}`>
    >().toEqualTypeOf<`motivo.${Lowercase<MotivoDeRechazo>}`>();
    expect(claves.filter((c) => c.startsWith("motivo."))).toHaveLength(5);
    expect(claves.filter((c) => c.startsWith("rol."))).toHaveLength(3);
  });

  it("los errores nuevos que ve una empresa o la puerta de entrada", () => {
    expect(claves.filter((c) => c.startsWith("error.")).sort()).toEqual([
      "error.empresa_de_otra_marca",
      "error.funcion_no_incluida",
      "error.inesperado",
      "error.invitacion_de_otra_marca",
      "error.limite_del_plan",
      "error.referencia",
    ]);
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
