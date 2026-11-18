import { describe, expect, it } from "vitest";
import { loQueSeCopia } from "./copia-de-opciones";
import type { GrupoConOpciones } from "./cotizar";
import type { ClaseDeGrupo, Grupo, Opcion } from "./modelo";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const grupo = (nombre: string, extra: Partial<Grupo> = {}, opciones: Partial<Opcion>[] = [{}]) =>
  ({
    grupo: {
      id: uuid(),
      productoId: uuid(),
      clase: "ADICIONAL" as ClaseDeGrupo,
      esTamano: false,
      nombre,
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      orden: 1,
      activo: true,
      ...extra,
    },
    opciones: opciones.map((o, i) => ({
      id: uuid(),
      grupoId: uuid(),
      orden: i,
      activa: true,
      versionId: uuid(),
      numero: 1,
      nombre: `Opción ${String(i)} de ${nombre}`,
      recargo: "0.000000",
      factorDeTamano: "1.0000",
      ...o,
    })),
  }) as unknown as GrupoConOpciones;

const nombres = (gs: readonly GrupoConOpciones[]) => gs.map((g) => g.grupo.nombre);
const entrada = (
  origen: GrupoConOpciones[],
  destino: GrupoConOpciones[] = [],
  puedeTraerLaVariante = true,
) => ({ gruposDelOrigen: origen, gruposDelDestino: destino, puedeTraerLaVariante });

describe("loQueSeCopia: la única regla de qué trae «Copiar de otro producto»", () => {
  it("trae los grupos activos del origen, en su orden, con sus opciones activas", () => {
    const a = grupo("Salsas", {}, [{ nombre: "Mayonesa" }, { nombre: "Sin stock", activa: false }]);
    const b = grupo("Guarnición", { clase: "INCLUIDA" });
    const r = loQueSeCopia(entrada([a, b]));
    expect(nombres(r)).toEqual(["Salsas", "Guarnición"]);
    expect(r[0]?.opciones.map((o) => o.nombre)).toEqual(["Mayonesa"]);
  });

  it("un grupo cuyo nombre el destino ya tiene no se trae, sin importar mayúsculas (claveDeNombre: NFC y minúsculas), esté activo o no en el destino", () => {
    const origen = [grupo("Salsas"), grupo("Panes"), grupo("Bebidas")];
    const destino = [grupo("SALSAS"), grupo("panes", { activo: false })];
    expect(nombres(loQueSeCopia(entrada(origen, destino)))).toEqual(["Bebidas"]);
  });

  it("un grupo desactivado del origen no se trae", () => {
    expect(
      nombres(loQueSeCopia(entrada([grupo("Viejo", { activo: false }), grupo("Nuevo")]))),
    ).toEqual(["Nuevo"]);
  });

  it("un grupo sin opciones activas no se trae (tampoco el que no tiene ninguna)", () => {
    const sinActivas = grupo("Apagadas", {}, [{ activa: false }, { activa: false }]);
    const vacio = grupo("Vacío", {}, []);
    expect(loQueSeCopia(entrada([sinActivas, vacio, grupo("Bien")]))).toHaveLength(1);
  });

  it("la variante solo se trae si el destino la puede recibir (`puedeTraerLaVariante`)", () => {
    const variante = grupo("Tamaño", { clase: "VARIANTE", esTamano: true });
    const comun = grupo("Salsas");
    expect(nombres(loQueSeCopia(entrada([variante, comun], [], true)))).toEqual([
      "Tamaño",
      "Salsas",
    ]);
    expect(nombres(loQueSeCopia(entrada([variante, comun], [], false)))).toEqual(["Salsas"]);
  });

  it("sin nada en el origen, o con todo ya en el destino, no hay nada para traer", () => {
    expect(loQueSeCopia(entrada([]))).toEqual([]);
    expect(loQueSeCopia(entrada([grupo("Salsas")], [grupo("Salsas")]))).toEqual([]);
  });

  it("no cambia lo que recibe ni devuelve las opciones inactivas", () => {
    const a = grupo("Salsas", {}, [{ nombre: "A" }, { nombre: "B", activa: false }]);
    const copia = JSON.stringify(a);
    const r = loQueSeCopia(entrada([a]));
    expect(JSON.stringify(a)).toBe(copia);
    expect(r[0]?.opciones.every((o) => o.activa)).toBe(true);
    expect(a.opciones).toHaveLength(2);
  });
});
