import type { OperacionContextual, TipoDeContexto } from "./tipos";

/**
 * El documento consultable del registro (escalabilidad X-1): una tabla de contextos y, por contexto, sus operaciones (no lo que
 * hacen: eso es del módulo dueño). Se guarda commiteado en `arquitectura/integracion/operaciones-contextuales.md` y una prueba
 * falla si difiere de lo generado. Se regenera con `npm run integracion:documento`. Pura y determinista (orden fijo).
 */
const celda = (v: string): string => v.replaceAll("|", "\\|");

export function documentoDeIntegracion(
  contextos: Readonly<Record<string, TipoDeContexto>>,
  operaciones: readonly OperacionContextual<string>[],
): string {
  const claves = Object.keys(contextos).toSorted();
  const lineas = [
    "# Operaciones contextuales",
    "",
    "> Generado por `npm run integracion:documento` desde `src/capacidades/integracion/`. No se edita a mano.",
    "",
  ];
  if (claves.length === 0) lineas.push("No hay contextos ni operaciones declarados.", "");
  else {
    lineas.push(
      "## Contextos",
      "",
      "| Contexto | Módulo | Propósito | Pantallas que lo entregan |",
      "|---|---|---|---|",
    );
    for (const k of claves) {
      const c = contextos[k]!;
      lineas.push(
        `| ${celda(k)} | ${c.modulo} | ${celda(c.proposito)} | ${c.loEntregan.map(celda).join(", ")} |`,
      );
    }
    lineas.push("");
    for (const k of claves) {
      lineas.push(`## Operaciones sobre ${k}`, "");
      const propias = operaciones
        .filter((o) => o.contexto === k)
        .toSorted((a, b) => a.orden - b.orden);
      if (propias.length === 0) lineas.push("Ninguna.", "");
      else {
        lineas.push(
          "| Id | Módulo | Permiso | Función de pago | Orden | Texto | Se abre en | Termina |",
          "|---|---|---|---|---|---|---|---|",
        );
        for (const o of propias)
          lineas.push(
            `| ${celda(o.id)} | ${o.modulo} | ${o.accion} | ${o.perilla ?? "-"} | ${o.orden} | ${o.etiqueta} | ${celda(o.seAbreEn)} | ${o.alTerminar} |`,
          );
        lineas.push("");
      }
    }
  }
  lineas.push(
    "Los otros dos registros no se duplican acá: el menú (`apps/web/ui/navegacion/menu.ts`) y los permisos (`src/capacidades/modulos/catalogo*.ts` y `src/capacidades/permisos/empresa.ts`).",
    "",
  );
  return lineas.join("\n");
}
