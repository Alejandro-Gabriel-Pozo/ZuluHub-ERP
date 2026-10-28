import { describe, expect, it } from "vitest";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import {
  DEFINICION_VACIA,
  type DefinicionDeMarca,
  type MarcaGuardada,
  type VersionConfirmadaDeMarca,
  type VersionDeMarcaGuardada,
} from "../../src/modulos/marcas/publico";
import { armarFichaDeMarca } from "../../src/plataforma/consultas/consultas-de-marcas";
import type {
  DependenciasDeConsultasDeMarcasYPlanes,
  FichaDeMarca,
  TxDeConsultasDeMarcasYPlanes,
} from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import { marcaComercialId } from "../../src/primitivas/identificadores/marca";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import { AHORA, comoAdministrador, conRol, transaccionesDe, uuid } from "./apoyo-de-soporte";

/**
 * `fichaDeMarca.ultimaConfirmada` sin base de datos: la última versión confirmada (mayor número, regida o
 * programada) con su número, su vigencia, su definición propia y la efectiva. La regla es la de
 * `definicionDeLaUltimaDecision`, la misma que usa guardar para armar el primer borrador (la prueba contra
 * Postgres, `ficha-de-marca-efectiva.test.ts`, fija esa coincidencia).
 */

const MARCA_ID = marcaComercialId(uuid(1));
const MARCA: MarcaGuardada = {
  id: MARCA_ID,
  codigo: "mc",
  marcaPadreId: null,
  nivel: 0,
  esPrincipal: false,
  estado: "ACTIVA",
  version: 1,
};

const HORA = 3_600_000;
const definicion = (nombre: string, primary: string, aspecto = {}): DefinicionDeMarca => ({
  ...DEFINICION_VACIA,
  nombreVisible: nombre,
  tema: { primary },
  aspecto,
});

const confirmada = (
  numero: number,
  desdeAhoraEnMs: number,
  def: DefinicionDeMarca,
): VersionConfirmadaDeMarca => ({
  id: uuid(100 + numero),
  marcaId: MARCA_ID,
  numero,
  estado: "CONFIRMADA",
  vigenteDesde: new Date(AHORA.getTime() + desdeAhoraEnMs),
  definicion: def,
  reemplazaProgramada: false,
  motivo: `versión ${numero}`,
  confirmadaEn: AHORA,
  confirmadaPor: uuid(900),
  version: 2,
});

const borradorCon = (def: DefinicionDeMarca): VersionDeMarcaGuardada => ({
  id: uuid(200),
  marcaId: MARCA_ID,
  numero: null,
  estado: "BORRADOR",
  vigenteDesde: null,
  definicion: def,
  reemplazaProgramada: false,
  motivo: null,
  confirmadaEn: null,
  confirmadaPor: null,
  version: 3,
});

async function ficha(
  confirmadas: readonly VersionConfirmadaDeMarca[],
  borrador: VersionDeMarcaGuardada | null = null,
): Promise<FichaDeMarca> {
  const tx = {
    autorizacionDePlataforma: conRol("ADMIN"),
    marcas: {
      obtener: () => Promise.resolve(MARCA),
      confirmadasDe: () => Promise.resolve(confirmadas),
      borradorDe: () => Promise.resolve(borrador),
      dominiosDeLaMarca: () => Promise.resolve([]),
    },
  } as unknown as TxDeConsultasDeMarcasYPlanes;
  const dependencias: DependenciasDeConsultasDeMarcasYPlanes = {
    transacciones: transaccionesDe(tx),
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
  };
  const r = await armarFichaDeMarca(dependencias)(comoAdministrador, { marcaId: MARCA_ID });
  if (!r.ok) throw new Error(`la ficha falló: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe("fichaDeMarca: ultimaConfirmada", () => {
  it("sin versiones confirmadas es null (y no hay efectiva)", async () => {
    const f = await ficha([]);
    expect(f.ultimaConfirmada).toBeNull();
    expect(f.efectiva).toBeNull();
  });

  it("con una sola versión vigente, la última es esa: su número, su vigencia, su definición y la misma efectiva", async () => {
    const v1 = confirmada(1, -HORA, definicion("Uno", "#111111", { estilo: "MODERNO" }));
    const f = await ficha([v1]);
    expect(f.ultimaConfirmada).toMatchObject({ numero: 1, vigenteDesde: v1.vigenteDesde });
    expect(f.ultimaConfirmada?.definicion).toBe(v1.definicion);
    expect(f.ultimaConfirmada?.efectiva).toEqual(f.efectiva);
  });

  it("con una vigente y una programada, devuelve la PROGRAMADA aunque `efectiva` siga siendo la vigente", async () => {
    const vigente = confirmada(1, -HORA, definicion("Hoy", "#111111", { estilo: "MODERNO" }));
    const programada = confirmada(2, HORA, definicion("Mañana", "#222222", { estilo: "LUDICO" }));
    for (const orden of [
      [vigente, programada],
      [programada, vigente],
    ]) {
      const f = await ficha(orden);
      expect(f.efectiva?.nombreVisible.valor).toBe("Hoy");
      expect(f.efectiva?.tema.primary.valor).toBe("#111111");
      expect(f.ultimaConfirmada).toMatchObject({
        numero: 2,
        vigenteDesde: programada.vigenteDesde,
      });
      expect(f.ultimaConfirmada?.definicion).toBe(programada.definicion);
      expect(f.ultimaConfirmada?.efectiva.nombreVisible).toEqual({
        valor: "Mañana",
        origen: { tipo: "propio" },
      });
      expect(f.ultimaConfirmada?.efectiva.tema.primary.valor).toBe("#222222");
      expect(f.ultimaConfirmada?.efectiva.aspecto.estilo.valor).toBe("LUDICO");
    }
  });

  it("con una programada y un borrador, el borrador no cambia la última confirmada y lo del borrador queda como era", async () => {
    const vigente = confirmada(1, -HORA, definicion("Hoy", "#111111"));
    const programada = confirmada(2, HORA, definicion("Mañana", "#222222"));
    const delBorrador = definicion("Borrador", "#333333");
    const sin = await ficha([vigente, programada]);
    const con = await ficha([vigente, programada], borradorCon(delBorrador));

    expect(con.ultimaConfirmada).toEqual(sin.ultimaConfirmada);
    expect(con.ultimaConfirmada?.numero).toBe(2);
    expect(con.efectiva).toEqual(sin.efectiva);
    expect(con.borrador).toEqual({ id: uuid(200), version: 3, definicion: delBorrador });
    expect(con.borradorEfectivo?.nombreVisible.valor).toBe("Borrador");
    expect(con.borradorEfectivo?.tema.primary.valor).toBe("#333333");
    expect(sin.borradorEfectivo).toBeNull();
  });
});
