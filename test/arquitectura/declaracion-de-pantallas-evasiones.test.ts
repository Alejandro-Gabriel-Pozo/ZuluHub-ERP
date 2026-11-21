import { describe, expect, it } from "vitest";
import { CAMINOS } from "../../src/capacidades/datos/caminos";
import type { ClaveAccion } from "../../src/capacidades/modulos/catalogo";
import type {
  BotonDeFicha,
  FichaDePantalla,
} from "../../src/capacidades/pantallas/tipos-de-fichas";
import type { UsosDeTexto } from "../../src/capacidades/vocabulario/uso-y-fuente-de-texto";
import {
  analizarDeclaraciones,
  type ContextoDeDeclaraciones,
  type Informe,
} from "./declaracion-de-pantallas-apoyo";

/**
 * Violaciones inyectadas de `declaracion-de-pantallas.test.ts` (reglas R1 a R4 y P1 a P4). Cada caso es una forma de usar un texto, un
 * botón, un modal o un campo sin declararlo, o de esquivar el análisis; si se debilita el analizador (`declaracion-de-pantallas-apoyo.ts`),
 * el caso deja de fallar y esta prueba se pone roja. Lo que el analizador no puede entender es un hallazgo `NO_ANALIZABLE` (fail-closed).
 * Cada caso trae su control: el mismo código bien declarado no da hallazgos.
 */

const MODULO_DE_LA_ACCION: Readonly<Record<string, string>> = {
  "medios_de_pago.editar": "caja",
  "medios_de_pago.crear": "caja",
  "comprobantes.emitir_manual": "facturacion",
};
const PANTALLA = "apps/web/app/caja/pantalla.tsx";
const OTRA = "apps/web/app/caja/otra.tsx";
const CABECERA = `import { texto } from "../../../src/capacidades/vocabulario/vocabulario";\nimport { Boton } from "x/Boton.cliente";\nimport { Campo } from "x/Campo";\nimport { Superposicion } from "x/Superposicion";\n`;

const base: ContextoDeDeclaraciones = {
  catalogo: {},
  datos: {},
  caminos: CAMINOS,
  fichas: {},
  codigo: new Map(),
  componentesDeBoton: ["x/Boton.cliente.tsx", "x/BotonIcono.tsx", "x/BotonDeEnvio.cliente.tsx"],
  componentesDeModal: ["x/Superposicion.tsx"],
  componentesDeCampo: ["x/Campo.tsx"],
  moduloDeAccion: (accion) => MODULO_DE_LA_ACCION[accion],
  moduloDeArchivo: (ruta) => (ruta.includes("/caja/") ? "caja" : undefined),
};

type Parcial = Partial<Omit<ContextoDeDeclaraciones, "codigo">> & {
  archivos?: Readonly<Record<string, string>>;
};
const correr = ({ archivos = {}, ...resto }: Parcial): Informe =>
  analizarDeclaraciones({ ...base, ...resto, codigo: new Map(Object.entries(archivos)) });
const reglas = (i: Informe): string[] => i.hallazgos.map((h) => h.regla);
const detalles = (i: Informe, regla: string): string[] =>
  i.hallazgos.filter((h) => h.regla === regla).map((h) => h.detalle);
/** Un componente de pantalla con el cuerpo dado, dentro de la función `Pantalla`. */
const pantalla = (cuerpo: string): string =>
  `${CABECERA}export function Pantalla(d: never) {\n  return ${cuerpo};\n}\n`;

const CLAVE = "caja.medios.titulo";
const otraClave = "caja.medios.agregar";
const catalogo = (usos?: UsosDeTexto) => ({
  [CLAVE]: usos === undefined ? { porDefecto: "T" } : { porDefecto: "T", usos },
});
const usaLaClave = pantalla(`<h1>{texto(d, "${CLAVE}")}</h1>`);

const boton = (id: string, hace: BotonDeFicha["hace"]): BotonDeFicha => ({
  id,
  texto: "caja.medios.titulo",
  hace,
  sinPermiso: "APAGADO",
});
const datoDelCamino = Object.values(CAMINOS["agregar-medio-de-pago"].pasos[0].campos)[0] as string;
const ficha = (parcial: Partial<FichaDePantalla> = {}): FichaDePantalla => ({
  id: "medios-de-pago",
  archivos: [PANTALLA],
  rutas: ["/caja/medios-de-pago"],
  titulo: "caja.medios.titulo",
  acceso: "medios_de_pago.editar",
  entradaDeMenu: null,
  caminos: ["agregar-medio-de-pago"],
  rotulos: {},
  botones: [boton("guardar", { envia: "medios_de_pago.crear" })],
  modales: [],
  estados: {},
  textos: [],
  estadoDeLaFicha: "EN_CONSTRUCCION",
  ...parcial,
});
const conFicha = (archivos: Record<string, string>, f: FichaDePantalla = ficha()): Informe =>
  correr({ archivos, fichas: { "medios-de-pago": f } });
const inventada = (accion: string): ClaveAccion => accion as unknown as ClaveAccion;

describe("R1: texto sin declarar", () => {
  it("una clave que no está en el catálogo", () => {
    const i = correr({ archivos: { [PANTALLA]: pantalla(`<h1>{texto(d, "x.nuevo")}</h1>`) } });
    expect(reglas(i)).toEqual(["R1"]);
    expect(detalles(i, "R1")[0]).toContain("no está en el catálogo");
  });

  it("una clave del catálogo sin `usos` que se usa", () => {
    const i = correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: catalogo() });
    expect(reglas(i)).toEqual(["R1"]);
    expect(i.medidas.clavesSinUsos).toBe(1);
  });

  it("con los usos declarados no hay hallazgo; `pendiente` es deuda medida, no un hallazgo", () => {
    const declarada = catalogo([{ como: "FUNCION", archivo: PANTALLA, nombre: "Pantalla" }]);
    expect(reglas(correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: declarada }))).toEqual(
      [],
    );
    const i = correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: catalogo("pendiente") });
    expect(reglas(i)).toEqual([]);
    expect(i.medidas.clavesConUsosPendientes).toBe(1);
  });

  it("las citas del catálogo y de las fichas no cuentan como consumo", () => {
    const i = correr({
      archivos: {
        "src/capacidades/vocabulario/catalogo-caja.ts": `export const X = { a: "${CLAVE}" };`,
        "src/capacidades/pantallas/fichas-de-caja.ts": `export const F = { titulo: "${CLAVE}" };`,
      },
      catalogo: catalogo(),
    });
    expect(reglas(i)).toEqual([]);
    expect(i.medidas.citasLiterales).toBe(0);
    expect(i.medidas.clavesSinCitar).toBe(1);
  });
});

describe("R2: consumidor no declarado", () => {
  const usos: UsosDeTexto = [{ como: "FUNCION", archivo: PANTALLA, nombre: "Pantalla" }];

  it("la usa un archivo que no figura en sus usos", () => {
    const i = correr({
      archivos: { [PANTALLA]: usaLaClave, [OTRA]: usaLaClave },
      catalogo: catalogo(usos),
    });
    expect(i.hallazgos.filter((h) => h.regla === "R2").map((h) => h.archivo)).toEqual([OTRA]);
  });

  it("la usa otra función del mismo archivo; la misma función con una clausura adentro sí cubre", () => {
    const otraFuncion = `${CABECERA}export function Pantalla() { return null; }\nexport function Otra(d: never) { return texto(d, "${CLAVE}"); }\n`;
    expect(
      reglas(correr({ archivos: { [PANTALLA]: otraFuncion }, catalogo: catalogo(usos) })),
    ).toEqual(["R2", "R3"]);
    const clausura = `${CABECERA}export function Pantalla(d: never) { const f = () => texto(d, "${CLAVE}"); return f(); }\n`;
    expect(
      reglas(correr({ archivos: { [PANTALLA]: clausura }, catalogo: catalogo(usos) })),
    ).toEqual([]);
  });

  it("un mapa de claves en una constante del módulo se declara por el nombre de la constante", () => {
    const mapa = `export const TIPOS = { efectivo: "${CLAVE}" } as const;\n`;
    const usosDelMapa: UsosDeTexto = [{ como: "FUNCION", archivo: PANTALLA, nombre: "TIPOS" }];
    expect(
      reglas(correr({ archivos: { [PANTALLA]: mapa }, catalogo: catalogo(usosDelMapa) })),
    ).toEqual([]);
    expect(reglas(correr({ archivos: { [PANTALLA]: mapa }, catalogo: catalogo(usos) }))).toContain(
      "R2",
    );
  });

  it("por dato: solo los consumidores del dato; por ficha: solo los archivos de una ficha que la cita", () => {
    const porDato: UsosDeTexto = [{ como: "DATO", dato: "nombre-de-medio-de-pago" }];
    const datos = { "nombre-de-medio-de-pago": { consumidores: [PANTALLA] } };
    const i = correr({
      archivos: { [PANTALLA]: usaLaClave, [OTRA]: usaLaClave },
      catalogo: catalogo(porDato),
      datos,
    });
    expect(i.hallazgos.filter((h) => h.regla === "R2").map((h) => h.archivo)).toEqual([OTRA]);
    const deFicha = catalogo(["DE_FICHA"]);
    const delaFicha = correr({
      archivos: { [PANTALLA]: usaLaClave, [OTRA]: usaLaClave },
      catalogo: deFicha,
      fichas: { f: ficha() },
    });
    expect(delaFicha.hallazgos.filter((h) => h.regla === "R2").map((h) => h.archivo)).toEqual([
      OTRA,
    ]);
  });
});

describe("R3: texto sin consumidor", () => {
  const usos: UsosDeTexto = [{ como: "FUNCION", archivo: PANTALLA, nombre: "Pantalla" }];

  it("declarar una clave y no usarla, o borrar su único uso", () => {
    expect(
      reglas(correr({ archivos: { [PANTALLA]: pantalla("<div />") }, catalogo: catalogo(usos) })),
    ).toEqual(["R3"]);
    expect(
      reglas(correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: catalogo(usos) })),
    ).toEqual([]);
  });

  it("`usos` vacío no tiene consumidor (aunque el tipo lo impida)", () => {
    const vacios = { [CLAVE]: { porDefecto: "T", usos: [] as unknown as UsosDeTexto } };
    expect(reglas(correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: vacios }))).toContain(
      "R3",
    );
  });

  it("`DE_FICHA` solo cuenta si una ficha la cita", () => {
    const deFicha = catalogo(["DE_FICHA"]);
    expect(
      reglas(correr({ archivos: { [PANTALLA]: pantalla("<div />") }, catalogo: deFicha })),
    ).toEqual(["R3"]);
    const i = correr({
      archivos: { [PANTALLA]: pantalla("<div />") },
      catalogo: deFicha,
      fichas: { f: ficha() },
    });
    expect(reglas(i)).toEqual([]);
  });
});

describe("R4: uso declarado inexistente", () => {
  it("renombrar la función sin tocar `usos`", () => {
    const renombrada = `${CABECERA}export function Renombrada(d: never) { return texto(d, "${CLAVE}"); }\n`;
    const usos: UsosDeTexto = [{ como: "FUNCION", archivo: PANTALLA, nombre: "Pantalla" }];
    const i = correr({ archivos: { [PANTALLA]: renombrada }, catalogo: catalogo(usos) });
    expect(detalles(i, "R4")[0]).toContain("Pantalla");
  });

  it("un archivo que no existe o un dato que no está en el registro", () => {
    const sinArchivo = catalogo([{ como: "FUNCION", archivo: "apps/no/existe.tsx", nombre: "X" }]);
    expect(
      reglas(correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: sinArchivo })),
    ).toContain("R4");
    const sinDato = catalogo([{ como: "DATO", dato: "no-existe" as never }]);
    expect(reglas(correr({ archivos: { [PANTALLA]: usaLaClave }, catalogo: sinDato }))).toContain(
      "R4",
    );
  });
});

describe("P1: botón sin declarar", () => {
  const conBoton = (atributos: string, etiqueta = "Boton") =>
    pantalla(`<${etiqueta} ${atributos}>Guardar</${etiqueta}>`);

  it("sin `boton=` y con un id que la ficha no declara, en un archivo de una ficha", () => {
    const sin = conFicha({ [PANTALLA]: conBoton("") });
    expect(sin.hallazgos.map((h) => [h.regla, h.linea])).toEqual([["P1", 6]]);
    expect(reglas(conFicha({ [PANTALLA]: conBoton('boton="otro"') }))).toEqual(["P1"]);
    expect(reglas(conFicha({ [PANTALLA]: conBoton('boton="guardar"') }))).toEqual([]);
  });

  it("también BotonDeEnvio, BotonIcono y el <button> crudo", () => {
    const todos = pantalla(`<div><BotonDeEnvio /><BotonIcono /><button>x</button></div>`).replace(
      'import { Boton } from "x/Boton.cliente";',
      'import { BotonDeEnvio } from "x/BotonDeEnvio.cliente";\nimport { BotonIcono } from "x/BotonIcono";',
    );
    const i = conFicha({ [PANTALLA]: todos });
    expect(reglas(i)).toEqual(["P1", "P1", "P1"]);
    expect(i.medidas.botones).toBe(3);
  });

  it("fuera de una ficha solo se mide (la deuda), no es un hallazgo", () => {
    const i = correr({ archivos: { [OTRA]: conBoton("") } });
    expect(reglas(i)).toEqual([]);
    expect([i.medidas.botones, i.medidas.botonesSinId]).toEqual([1, 1]);
  });

  it("un id dinámico, con {...props} o en un modal de la ficha no se puede analizar o se acepta según corresponda", () => {
    expect(reglas(conFicha({ [PANTALLA]: conBoton("boton={id}") }))).toEqual(["NO_ANALIZABLE"]);
    expect(reglas(conFicha({ [PANTALLA]: conBoton("{...props}") }))).toEqual(["NO_ANALIZABLE"]);
    expect(reglas(conFicha({ [PANTALLA]: conBoton('{...props} boton="guardar"') }))).toEqual([]);
    const delModal = ficha({
      modales: [
        {
          id: "confirmar",
          titulo: "caja.medios.titulo",
          botones: [boton("si", { envia: "medios_de_pago.editar" })],
        },
      ],
    });
    expect(reglas(conFicha({ [PANTALLA]: conBoton('boton="si"') }, delModal))).toEqual([]);
  });

  it("las evasiones por alias, espacio de nombres, nombre compuesto o referencia fallan cerrado", () => {
    const alias = pantalla('<B boton="guardar" />').replace("{ Boton }", "{ Boton as B }");
    expect(reglas(conFicha({ [PANTALLA]: alias }))).toContain("NO_ANALIZABLE");
    const compuesto = `${CABECERA}import * as UI from "x/Boton.cliente";\nexport const P = () => <UI.Boton boton="guardar" />;\n`;
    expect(reglas(conFicha({ [PANTALLA]: compuesto }))).toContain("NO_ANALIZABLE");
    const referencia = `${CABECERA}const B = Boton;\nexport const P = () => <B boton="guardar" />;\n`;
    expect(reglas(conFicha({ [PANTALLA]: referencia }))).toContain("NO_ANALIZABLE");
  });

  it("el archivo que ES el componente no cuenta sus propios botones, y una hoja de estilos con otro nombre no es un alias", () => {
    const implementacion = `export function Boton() { return <button>x</button>; }\n`;
    expect(correr({ archivos: { "x/Boton.cliente.tsx": implementacion } }).medidas.botones).toBe(0);
    const estilos = `import estilos from "./Boton.module.css";\nexport const P = () => <div className={estilos.a} />;\n`;
    expect(reglas(correr({ archivos: { [OTRA]: estilos } }))).toEqual([]);
  });
});

describe("P2: acción del botón", () => {
  const conAccion = (hace: BotonDeFicha["hace"]) =>
    correr({
      fichas: { f: ficha({ botones: [boton("b", hace)] }) },
      archivos: { [PANTALLA]: pantalla("<div />") },
    });

  it("una acción que no existe en el catálogo", () => {
    expect(detalles(conAccion({ envia: inventada("caja.otra") }), "P2")[0]).toContain(
      "no es una acción del catálogo",
    );
  });

  it("una acción de otro módulo", () => {
    const i = conAccion({ envia: "comprobantes.emitir_manual" });
    expect(detalles(i, "P2")[0]).toContain("facturacion");
  });

  it("un botón que no hace nada, o que hace dos cosas", () => {
    expect(reglas(conAccion({} as unknown as BotonDeFicha["hace"]))).toEqual(["P2"]);
    const dos = { envia: "medios_de_pago.crear", navega: "/x" } as unknown as BotonDeFicha["hace"];
    expect(reglas(conAccion(dos))).toEqual(["P2"]);
    expect(reglas(conAccion({ envia: inventada("") }))).toEqual(["P2"]);
  });

  it("la acción de su propio módulo, una ruta o un modal declarado pasan", () => {
    expect(reglas(conAccion({ envia: "medios_de_pago.editar" }))).toEqual([]);
    expect(reglas(conAccion({ navega: "/caja/medios-de-pago/nuevo" }))).toEqual([]);
  });

  it("sin un módulo determinable para la ficha no se puede comprobar y falla cerrado", () => {
    const i = correr({
      fichas: { f: ficha({ archivos: ["apps/web/app/otro/p.tsx"] }) },
      archivos: { "apps/web/app/otro/p.tsx": pantalla("<div />") },
    });
    expect(reglas(i)).toEqual(["NO_ANALIZABLE"]);
  });

  it("una ficha que nombra un archivo que no existe no se puede analizar", () => {
    const i = correr({ fichas: { f: ficha() }, archivos: {} });
    expect(reglas(i)).toContain("NO_ANALIZABLE");
  });
});

describe("P3: campo fuera de la ficha", () => {
  const campo = (dato: string) => pantalla(`<Campo etiqueta="a" dato="${dato}" />`);

  it("un dato que ningún paso de los caminos de la ficha completa", () => {
    expect(reglas(conFicha({ [PANTALLA]: campo("dato-que-nadie-declara") }))).toEqual(["P3"]);
    expect(reglas(conFicha({ [PANTALLA]: campo(datoDelCamino) }))).toEqual([]);
  });

  it("un dato que no es un literal, o `pendiente`, no coincide con la ficha", () => {
    const dinamico = pantalla(`<Campo etiqueta="a" dato={d} />`);
    expect(reglas(conFicha({ [PANTALLA]: dinamico }))).toEqual(["P3"]);
    expect(reglas(conFicha({ [PANTALLA]: campo("pendiente") }))).toEqual(["P3"]);
  });

  it("fuera de una ficha el campo lo sigue mirando `campos-con-dato`, no esta regla", () => {
    expect(reglas(correr({ archivos: { [OTRA]: campo("dato-que-nadie-declara") } }))).toEqual([]);
  });
});

describe("P4: modal no declarado", () => {
  const modal = (atributos: string, etiqueta = "Superposicion") =>
    pantalla(`<${etiqueta} ${atributos}>contenido</${etiqueta}>`);
  const conModal = ficha({
    modales: [{ id: "confirmar", titulo: "caja.medios.titulo", botones: [] }],
  });

  it("una Superposicion sin `modal=` o con un id que la ficha no declara", () => {
    expect(reglas(conFicha({ [PANTALLA]: modal("") }))).toEqual(["P4"]);
    expect(reglas(conFicha({ [PANTALLA]: modal('modal="otro"') }, conModal))).toEqual(["P4"]);
    expect(reglas(conFicha({ [PANTALLA]: modal('modal="confirmar"') }, conModal))).toEqual([]);
  });

  it("un <dialog> crudo cuenta como modal", () => {
    expect(reglas(conFicha({ [PANTALLA]: modal("", "dialog") }))).toEqual(["P4"]);
  });

  it("un botón que abre un modal que la ficha no declara", () => {
    const abre = ficha({ botones: [boton("abrir", { abre: "no-existe" })] });
    expect(reglas(conFicha({ [PANTALLA]: pantalla("<div />") }, abre))).toEqual(["P4"]);
  });

  it("un `modal=` dinámico no se puede analizar", () => {
    expect(reglas(conFicha({ [PANTALLA]: modal("modal={m}") }, conModal))).toEqual([
      "NO_ANALIZABLE",
    ]);
  });
});

describe("lo que el analizador no puede leer falla cerrado", () => {
  it("un error de sintaxis", () => {
    expect(reglas(correr({ archivos: { [PANTALLA]: "export const = ;" } }))).toEqual([
      "NO_ANALIZABLE",
    ]);
  });

  it("una clave que no es un literal (plantilla, variable, llamada)", () => {
    for (const clave of ["`caja.${x}`", "clave", "f()"]) {
      const i = correr({ archivos: { [PANTALLA]: pantalla(`<h1>{texto(d, ${clave})}</h1>`) } });
      expect(reglas(i), clave).toEqual(["NO_ANALIZABLE"]);
    }
    const sinClave = correr({ archivos: { [PANTALLA]: pantalla("<h1>{texto(d)}</h1>") } });
    expect(reglas(sinClave)).toEqual(["NO_ANALIZABLE"]);
  });

  it("una condición de literales sí se lee: las dos claves cuentan", () => {
    const i = correr({
      archivos: { [PANTALLA]: pantalla(`<h1>{texto(d, ok ? "${CLAVE}" : "${otraClave}")}</h1>`) },
      catalogo: { [CLAVE]: { porDefecto: "T" }, [otraClave]: { porDefecto: "U" } },
    });
    expect(i.medidas.llamadasATexto).toBe(2);
    expect(reglas(i)).toEqual(["R1", "R1"]);
  });

  it("`texto` con alias, como valor o por espacio de nombres", () => {
    const alias = usaLaClave.replace("{ texto }", "{ texto as t }").replace("texto(d", "t(d");
    expect(
      reglas(correr({ archivos: { [PANTALLA]: alias }, catalogo: catalogo("pendiente") })),
    ).toContain("NO_ANALIZABLE");
    const valor = `${CABECERA}const f = texto;\nexport const P = () => f;\n`;
    expect(reglas(correr({ archivos: { [PANTALLA]: valor } }))).toContain("NO_ANALIZABLE");
    const espacio = `import * as V from "../../../src/capacidades/vocabulario/vocabulario";\nexport const P = (d: never) => V.texto(d, "${CLAVE}");\n`;
    expect(reglas(correr({ archivos: { [PANTALLA]: espacio } }))).toContain("NO_ANALIZABLE");
  });

  it("una variable o un parámetro llamado `texto` en un archivo que no importa el vocabulario no es una llamada", () => {
    const local = `export const f = (texto: string) => texto.length;\n`;
    expect(reglas(correr({ archivos: { [PANTALLA]: local } }))).toEqual([]);
  });

  it("una clave con forma de clave en un tipo no es un uso", () => {
    const tipo = `export type K = "${CLAVE}";\n`;
    expect(
      correr({ archivos: { [PANTALLA]: tipo }, catalogo: catalogo() }).medidas.citasLiterales,
    ).toBe(0);
  });

  it("las pruebas no son consumidores: el chequeo real no las lee (la medición recibe solo código)", () => {
    const i = correr({ archivos: {}, catalogo: catalogo() });
    expect(i.medidas.clavesSinCitar).toBe(1);
  });
});
