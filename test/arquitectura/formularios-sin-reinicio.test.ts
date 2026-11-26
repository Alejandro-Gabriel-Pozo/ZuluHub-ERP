import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Todo `<form action={…}>` con una acción de React cancela el reinicio automático del formulario (`onReset={sinReiniciar}`, `apps/web/ui/patrones/sin-reinicio.ts`). React 19 reinicia el
 * formulario al terminar la acción y deja las casillas y los campos CONTROLADOS mostrando otra cosa que su estado: la pantalla muestra una cosa y el siguiente envío manda otra (caso real,
 * 26/11/2026: las sucursales de un empleado, que mueven permisos). Previene que un formulario nuevo vuelva a nacer con ese desorden. Los formularios `method="get"` (filtros) no tienen acción
 * de React y no cuentan. LÍMITES: es un análisis de TEXTO del JSX (lee cada etiqueta `<form …>` hasta su `>`); no ve un formulario armado con `createElement` ni uno que reciba sus atributos
 * por propagación (`{...props}`); el primero lo prohíbe la regla de campos con dato y el segundo no existe hoy.
 */
const RAIZ = join(import.meta.dirname, "../..");

/** Los atributos de cada etiqueta `<form` del texto (hasta el `>` que la cierra, sin contar los de dentro de llaves ni de comillas). */
function etiquetasDeFormulario(texto: string): string[] {
  const etiquetas: string[] = [];
  for (const inicio of texto.matchAll(/<form(?=[\s>])/g)) {
    let i = inicio.index + "<form".length;
    let llaves = 0;
    let comilla = "";
    const desde = i;
    for (; i < texto.length; i += 1) {
      const c = texto.charAt(i);
      if (comilla !== "") {
        if (c === comilla) comilla = "";
      } else if (c === '"' || c === "'" || c === "`") comilla = c;
      else if (c === "{") llaves += 1;
      else if (c === "}") llaves -= 1;
      else if (c === ">" && llaves === 0) break;
    }
    etiquetas.push(texto.slice(desde, i));
  }
  return etiquetas;
}

/** Las etiquetas `<form` con acción de React que NO cancelan el reinicio. */
export function formulariosSinReinicio(texto: string): string[] {
  return etiquetasDeFormulario(texto).filter(
    (atributos) =>
      /\baction=\{/.test(atributos) &&
      !/\bmethod="get"/.test(atributos) &&
      !/\bonReset=\{sinReiniciar\}/.test(atributos),
  );
}

describe("los formularios con acción cancelan el reinicio de React", () => {
  it("un formulario con acción y `onReset={sinReiniciar}` no tiene problemas, en una línea o en varias", () => {
    expect(formulariosSinReinicio("<form action={enviar} onReset={sinReiniciar}>")).toEqual([]);
    expect(
      formulariosSinReinicio("<form\n  noValidate\n  action={enviar}\n  onReset={sinReiniciar}\n>"),
    ).toEqual([]);
  });

  it("VIOLACIÓN: un formulario con acción de React sin cancelar el reinicio falla", () => {
    expect(formulariosSinReinicio("<form action={enviar}>")).toHaveLength(1);
    expect(formulariosSinReinicio("<form action={enviar} noValidate>")).toHaveLength(1);
    expect(formulariosSinReinicio("<form\n  action={anular}\n  className={x}\n>")).toHaveLength(1);
  });

  it("VIOLACIÓN: `onReset` con otro manejador (que no cancela) tampoco alcanza", () => {
    expect(formulariosSinReinicio("<form action={enviar} onReset={() => limpiar()}>")).toHaveLength(
      1,
    );
    expect(formulariosSinReinicio("<form action={enviar} onReset={otra}>")).toHaveLength(1);
  });

  it("un `>` dentro de un atributo (una función flecha) no corta la etiqueta antes de tiempo", () => {
    expect(
      formulariosSinReinicio("<form action={(d) => enviar(d)} onSubmit={() => 1}>"),
    ).toHaveLength(1);
    expect(
      formulariosSinReinicio('<form action={(d) => enviar(d)} onReset={sinReiniciar} id="a>b">'),
    ).toEqual([]);
  });

  it('los formularios de filtros (`method="get"`) y los que se envían con `onSubmit` no cuentan', () => {
    expect(
      formulariosSinReinicio('<form method="get" action={filtros.accion} role="search">'),
    ).toEqual([]);
    expect(formulariosSinReinicio("<form noValidate onSubmit={enviar}>")).toEqual([]);
    expect(formulariosSinReinicio('<form method="get" action="/empresas">')).toEqual([]);
  });

  it("varios formularios en un mismo archivo: se cuentan solo los que fallan", () => {
    const texto =
      "<form action={a} onReset={sinReiniciar}><form action={b}><formulario action={c}>";
    expect(formulariosSinReinicio(texto)).toHaveLength(1);
  });

  it("el repositorio real: ningún formulario con acción de React deja que React lo reinicie", () => {
    const archivos = [
      ...globSync("apps/web/**/*.tsx", { cwd: RAIZ }),
      ...globSync("apps/plataforma/**/*.tsx", { cwd: RAIZ }),
    ].filter((a) => !/\.test\.tsx$/.test(a) && !a.includes("node_modules"));
    expect(archivos.length).toBeGreaterThan(100);
    const faltan = archivos.filter(
      (a) => formulariosSinReinicio(readFileSync(join(RAIZ, a), "utf8")).length > 0,
    );
    expect(faltan).toEqual([]);
  });

  it("`FormularioDeAccion` (el patrón compartido) lo trae", () => {
    const texto = readFileSync(
      join(RAIZ, "apps/web/ui/patrones/FormularioDeAccion.cliente.tsx"),
      "utf8",
    );
    expect(etiquetasDeFormulario(texto)).toHaveLength(1);
    expect(texto).toContain("onReset={sinReiniciar}");
    expect(formulariosSinReinicio(texto)).toEqual([]);
  });
});
