import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "./catalogo";
import { TEXTOS_DE_COMANDAS } from "./catalogo-comandas";

/**
 * Los textos de la pantalla «Impresoras» y del botón «Imprimir» (S-2) declaran dónde se usan (`usos`) y de dónde salen (`fuente`: DEC-0715, la maqueta `imprimir.html` aprobada el 09/11/2026). Esta prueba
 * afirma cada declaración EXACTA (valor, archivo, función y decisión) y que cada archivo declarado existe. Previene: un uso mal escrito (otro archivo o función) o una fuente cambiada que el inventario de textos no
 * detecta, y que la mutación del vocabulario deje sobrevivir esas constantes.
 */
const MODELO = "apps/web/ui/plantillas/salon/modelo-de-impresoras.ts";
const PAGINAS = "apps/web/app/s/app/(operacion)/salon/impresoras";
const funcion = (archivo: string, nombre: string) => ({ como: "FUNCION", archivo, nombre });
const EN_LA_LISTA = funcion(MODELO, "armarLaListaDeImpresoras");
const EN_EL_FORMULARIO = funcion(MODELO, "armarElFormularioDeImpresora");
const EN_EL_TEXTO_DEL_USO = funcion(MODELO, "textoDelUso");
const EN_EL_MENU = funcion("apps/web/ui/navegacion/menu.ts", "FILAS_DEL_MENU");
const EN_LA_PAGINA_DE_LA_LISTA = funcion(`${PAGINAS}/page.tsx`, "PaginaDeLaListaDeImpresoras");
const EN_LA_PAGINA_DE_LA_EDICION = funcion(`${PAGINAS}/[id]/page.tsx`, "PaginaDeLaImpresora");
const EN_LA_PAGINA_DEL_ALTA = funcion(`${PAGINAS}/nueva/page.tsx`, "PaginaDeLaImpresoraNueva");
const EN_EL_BOTON = funcion(
  "apps/web/ui/patrones/papel/textos-de-imprimir.ts",
  "armarLosTextosDeImprimir",
);

const ESPERADOS = [
  ["imprimir_imprimir", "Imprimir", [EN_EL_BOTON]],
  ["imprimir_imprimiendo", "Imprimiendo", [EN_EL_BOTON, EN_LA_LISTA]],
  ["imprimir_impresa", "Impresa", [EN_EL_BOTON]],
  ["imprimir_no_se_pudo_imprimir", "No se pudo imprimir", [EN_EL_BOTON]],
  ["imprimir_reintentar", "Reintentar", [EN_EL_BOTON]],
  ["imprimir_ver_en_pantalla", "Ver en pantalla", [EN_EL_BOTON]],
  [
    "imprimir_impresoras",
    "Impresoras",
    [EN_EL_FORMULARIO, EN_EL_MENU, EN_LA_PAGINA_DE_LA_LISTA, EN_LA_PAGINA_DE_LA_EDICION],
  ],
  [
    "imprimir_agregar_impresora",
    "Agregar impresora",
    [EN_LA_LISTA, EN_EL_FORMULARIO, EN_LA_PAGINA_DEL_ALTA],
  ],
  ["imprimir_nombre", "Nombre", [EN_EL_FORMULARIO]],
  ["imprimir_para_que_sirve", "Para qué sirve", [EN_EL_FORMULARIO]],
  ["imprimir_comanda_de_cocina", "Comanda de cocina", [EN_EL_TEXTO_DEL_USO]],
  ["imprimir_ticket_del_cliente", "Ticket del cliente", [EN_EL_TEXTO_DEL_USO]],
  ["imprimir_papel", "Papel", [EN_EL_FORMULARIO]],
  ["imprimir_imprimir_prueba", "Imprimir prueba", [EN_LA_LISTA]],
  ["imprimir_no_hay_impresoras", "No hay impresoras", [EN_LA_LISTA]],
  [
    "imprimir_no_hay_impresora_para_la_comanda_de_cocina",
    "No hay impresora para la comanda de cocina",
    [EN_EL_BOTON],
  ],
  ["salida_quitar", "Quitar", [EN_LA_LISTA]],
] as const;

describe("textos de «Impresoras» e «Imprimir» (comandas)", () => {
  it.each(ESPERADOS)("«%s»: texto, usos y fuente exactos", (clave, texto, usos) => {
    const definicion =
      TEXTOS_DE_COMANDAS[`comandas.texto.${clave}` as keyof typeof TEXTOS_DE_COMANDAS];
    expect(definicion).toEqual({ porDefecto: texto, usos, fuente: { decision: "DEC-0715" } });
  });

  it("también están en el catálogo común, con lo mismo", () => {
    for (const [clave] of ESPERADOS) {
      const completa = `comandas.texto.${clave}` as keyof typeof CATALOGO_DE_TEXTOS;
      expect(CATALOGO_DE_TEXTOS[completa]).toBe(
        TEXTOS_DE_COMANDAS[completa as keyof typeof TEXTOS_DE_COMANDAS],
      );
    }
  });

  it("cada archivo que un uso declara existe", () => {
    const raiz = join(import.meta.dirname, "../../..");
    const archivos = new Set(ESPERADOS.flatMap(([, , usos]) => usos.map((u) => u.archivo)));
    expect(archivos.size).toBe(6);
    for (const archivo of archivos) expect(existsSync(join(raiz, archivo)), archivo).toBe(true);
  });
});
