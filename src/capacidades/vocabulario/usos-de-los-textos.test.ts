import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "./catalogo";

/**
 * Los textos que ya declaran quién los consume (`usos`) y de dónde salen (`fuente`): ESTA tabla es lo que los afirma. Previene: que un `usos` mal escrito
 * (otro archivo, otra función, otra clave) o una `fuente` cambiada pasen sin que ninguna prueba del vocabulario lo note (la mutación del grupo «vocabulario»
 * lo detectó en S-2: ~41 mutantes sobrevivían en las constantes de uso de `catalogo-comandas.ts`). Un texto con `usos` que no figura acá falla: se agrega a la tabla
 * en el mismo cambio que declara su uso. El analizador de `test/arquitectura/declaracion-de-pantallas-apoyo.ts` mide el consumo real; esto fija lo DECLARADO.
 */

type Uso = { como: "FUNCION"; archivo: string; nombre: string };
const funcion = (archivo: string, nombre: string): Uso => ({ como: "FUNCION", archivo, nombre });

const MODELO_DE_IMPRESORAS = "apps/web/ui/plantillas/salon/modelo-de-impresoras.ts";
const RUTA_DE_PAGINAS = "apps/web/app/s/app/(operacion)/salon/impresoras";
const EN_LA_LISTA = funcion(MODELO_DE_IMPRESORAS, "armarLaListaDeImpresoras");
const EN_EL_FORMULARIO = funcion(MODELO_DE_IMPRESORAS, "armarElFormularioDeImpresora");
const EN_EL_TEXTO_DEL_USO = funcion(MODELO_DE_IMPRESORAS, "textoDelUso");
const EN_EL_MENU = funcion("apps/web/ui/navegacion/menu.ts", "FILAS_DEL_MENU");
const EN_LA_PAGINA_DE_LA_LISTA = funcion(
  `${RUTA_DE_PAGINAS}/page.tsx`,
  "PaginaDeLaListaDeImpresoras",
);
const EN_LA_PAGINA_DE_LA_EDICION = funcion(
  `${RUTA_DE_PAGINAS}/[id]/page.tsx`,
  "PaginaDeLaImpresora",
);
const EN_LA_PAGINA_DEL_ALTA = funcion(
  `${RUTA_DE_PAGINAS}/nueva/page.tsx`,
  "PaginaDeLaImpresoraNueva",
);
const EN_EL_BOTON_DE_IMPRIMIR = funcion(
  "apps/web/ui/patrones/papel/textos-de-imprimir.ts",
  "armarLosTextosDeImprimir",
);
const DE_IMPRIMIR = { decision: "DEC-0715" };

/** clave → los usos declarados (en orden) y su fuente (`undefined`: no declara fuente). */
const DECLARADOS: ReadonlyArray<readonly [ClaveDeTexto, readonly Uso[], unknown]> = [
  ["comandas.texto.salida_quitar", [EN_LA_LISTA], DE_IMPRIMIR],
  ["comandas.texto.imprimir_imprimir", [EN_EL_BOTON_DE_IMPRIMIR], DE_IMPRIMIR],
  ["comandas.texto.imprimir_imprimiendo", [EN_EL_BOTON_DE_IMPRIMIR, EN_LA_LISTA], DE_IMPRIMIR],
  ["comandas.texto.imprimir_impresa", [EN_EL_BOTON_DE_IMPRIMIR], DE_IMPRIMIR],
  ["comandas.texto.imprimir_no_se_pudo_imprimir", [EN_EL_BOTON_DE_IMPRIMIR], DE_IMPRIMIR],
  ["comandas.texto.imprimir_reintentar", [EN_EL_BOTON_DE_IMPRIMIR], DE_IMPRIMIR],
  ["comandas.texto.imprimir_ver_en_pantalla", [EN_EL_BOTON_DE_IMPRIMIR], DE_IMPRIMIR],
  [
    "comandas.texto.imprimir_impresoras",
    [EN_EL_FORMULARIO, EN_EL_MENU, EN_LA_PAGINA_DE_LA_LISTA, EN_LA_PAGINA_DE_LA_EDICION],
    DE_IMPRIMIR,
  ],
  [
    "comandas.texto.imprimir_agregar_impresora",
    [EN_LA_LISTA, EN_EL_FORMULARIO, EN_LA_PAGINA_DEL_ALTA],
    DE_IMPRIMIR,
  ],
  ["comandas.texto.imprimir_nombre", [EN_EL_FORMULARIO], DE_IMPRIMIR],
  ["comandas.texto.imprimir_para_que_sirve", [EN_EL_FORMULARIO], DE_IMPRIMIR],
  ["comandas.texto.imprimir_comanda_de_cocina", [EN_EL_TEXTO_DEL_USO], DE_IMPRIMIR],
  ["comandas.texto.imprimir_ticket_del_cliente", [EN_EL_TEXTO_DEL_USO], DE_IMPRIMIR],
  ["comandas.texto.imprimir_papel", [EN_EL_FORMULARIO], DE_IMPRIMIR],
  ["comandas.texto.imprimir_imprimir_prueba", [EN_LA_LISTA], DE_IMPRIMIR],
  ["comandas.texto.imprimir_no_hay_impresoras", [EN_LA_LISTA], DE_IMPRIMIR],
  [
    "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina",
    [EN_EL_BOTON_DE_IMPRIMIR],
    DE_IMPRIMIR,
  ],
  [
    "salon.texto.admin_guardar",
    [
      funcion("apps/web/ui/plantillas/salon/modelo-de-mesas.ts", "armarElFormularioDeMesa"),
      EN_EL_FORMULARIO,
    ],
    undefined,
  ],
];

const definicion = (clave: ClaveDeTexto) =>
  CATALOGO_DE_TEXTOS[clave] as { usos?: unknown; fuente?: unknown };

describe("los usos y la fuente que declaran los textos del catálogo", () => {
  it.each(DECLARADOS)("%s declara exactamente sus usos y su fuente", (clave, usos, fuente) => {
    expect(definicion(clave).usos).toEqual(usos);
    expect(definicion(clave).fuente).toEqual(fuente);
  });

  it("ningún otro texto declara usos ni fuente sin figurar en la tabla", () => {
    const conDeclaracion = (Object.keys(CATALOGO_DE_TEXTOS) as ClaveDeTexto[])
      .filter(
        (clave) => definicion(clave).usos !== undefined || definicion(clave).fuente !== undefined,
      )
      .sort();
    expect(conDeclaracion).toEqual(DECLARADOS.map(([clave]) => clave).sort());
  });
});
