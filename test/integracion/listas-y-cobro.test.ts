import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cajaParaVentas } from "../../src/modulos/caja/publico";
import type { CasosDeUsoDeListas } from "../../src/plataforma/casos-de-uso/listas-del-sistema";
import { ok } from "../../src/primitivas/resultado/resultado";
import { armarCaja, crearEntornoDeCaja } from "./caja-configuracion-apoyo";
import {
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import { claveNueva, conAhora, instanteLocal, pesos } from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { crearCasosDeListas, crearEntornoDeListas, valorPorNombre } from "./listas-apoyo";
import { clave, comoAdminAhora, exito } from "./marcas-y-planes-apoyo";

/**
 * Las listas del sistema y el cobro, de punta a punta (e3 §3.7): lo que la PLATAFORMA cambia en una lista lo ve el cobro de la empresa.
 * Corregir el nombre cambia cómo se ve también lo ya cobrado (el cobro guarda el id, no el texto); desactivar deja de ofrecer la marca en
 * cobros NUEVOS y los viejos la conservan; reactivar la devuelve. Base propia.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("listas del sistema y cobro", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entornoCaja: ReturnType<typeof crearEntornoDeCaja>;
  let entornoListas: ReturnType<typeof crearEntornoDeListas>;
  let caja: ReturnType<typeof armarCaja>;
  let listas: CasosDeUsoDeListas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entornoCaja = crearEntornoDeCaja(propia.base, 8);
    entornoListas = crearEntornoDeListas(propia.base);
    caja = armarCaja(entornoCaja);
    listas = crearCasosDeListas(entornoListas);
  });
  afterAll(async () => {
    await dueno.end();
    await entornoCaja.cerrar();
    await entornoBase.cerrar();
    await entornoListas.cerrar();
    await propia.destruir();
  });

  const ctx = (m: MundoDeCobro) =>
    conAhora(m.ctx(), new Date(instanteLocal(1, "10:00").getTime() + 5 * 60_000));
  const cobrarConMarca = (m: MundoDeCobro, marcaDeTarjetaId: string) =>
    cobrarComoVentas(
      entornoCaja,
      ctx(m),
      entradaDeCobro(m, {
        medioDePagoId: m.medios.TARJETA_CREDITO,
        datos: { marcaDeTarjetaId },
      }),
    );
  /** Cómo se ve ahora, para quien mira lo cobrado, la marca de cada cobro de la empresa (el nombre sale de la lista por el id). */
  const marcasCobradas = async (m: MundoDeCobro) =>
    (
      await dueno.query<{ id: string; nombre: string }>(
        `select v.id, v.nombre from cobro c join valor_de_lista v on v.id = c.marca_de_tarjeta_id
          where c.empresa_id = $1 order by c.creado_en, c.movimiento_id`,
        [m.empresa],
      )
    ).rows;
  const marcasOfrecidas = async (m: MundoDeCobro) => {
    const r = await entornoCaja.ejecutar(
      { contexto: ctx(m), aislamiento: "read committed", soloLectura: true },
      async (tx) => ok(await cajaParaVentas.opcionesDeCobro(tx, ctx(m), m.cajaId)),
    );
    if (!r.ok || !r.valor.ok) throw new Error(JSON.stringify(r));
    return r.valor.valor.marcasDeTarjeta.map((x) => x.nombre);
  };

  it("corregir el nombre cambia cómo se ve lo ya cobrado; desactivar deja de ofrecerla en cobros nuevos y los viejos la conservan; reactivar la devuelve", async () => {
    const m = await crearMundoDeCobro(entornoBase, dueno, caja);
    const abierta = await caja.casos.abrirSesion(ctx(m), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!abierta.ok) throw new Error(JSON.stringify(abierta.error));
    const medio = m.medios.TARJETA_CREDITO;
    const [fila] = (
      await dueno.query<{ version: number; nombre: string | null }>(
        "select version, nombre from medio_de_pago where id = $1",
        [medio],
      )
    ).rows;
    const habilitado = await caja.casos.editarMedioDePago(m.ctx(), {
      medioDePagoId: medio,
      versionEsperada: fila?.version as number,
      nombre: fila?.nombre ?? null,
      datos: { cupon: false, ultimos4: false, marca: true, cuotas: false, dni: false },
    });
    expect(habilitado.ok).toBe(true);

    const cabal = await valorPorNombre(dueno, "MARCAS_DE_TARJETA", "Cabal");
    const viejo = await cobrarConMarca(m, cabal.id);
    expect(viejo.ok).toBe(true);
    expect(await marcasCobradas(m)).toEqual([{ id: cabal.id, nombre: "Cabal" }]);

    // La plataforma corrige el nombre: el cobro ya hecho apunta al mismo id y se ve con el nombre nuevo.
    exito(
      await listas.corregirNombreDeValor(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        valorId: cabal.id,
        nombre: "Cabal Argentina",
        versionEsperada: cabal.version,
      }),
    );
    expect(await marcasCobradas(m)).toEqual([{ id: cabal.id, nombre: "Cabal Argentina" }]);
    expect(await marcasOfrecidas(m)).toContain("Cabal Argentina");
    expect(await marcasOfrecidas(m)).not.toContain("Cabal");

    // La desactiva: no se ofrece ni se acepta en cobros NUEVOS; el cobro viejo la conserva.
    const corregida = await valorPorNombre(dueno, "MARCAS_DE_TARJETA", "Cabal Argentina");
    exito(
      await listas.desactivarValorDeLista(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        valorId: cabal.id,
        versionEsperada: corregida.version,
      }),
    );
    expect(await marcasOfrecidas(m)).not.toContain("Cabal Argentina");
    expect(await cobrarConMarca(m, cabal.id)).toEqual({
      ok: false,
      error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "marca", motivo: "NO_DISPONIBLE" },
    });
    expect(await marcasCobradas(m)).toEqual([{ id: cabal.id, nombre: "Cabal Argentina" }]);

    // La reactiva: vuelve a ofrecerse y a aceptarse.
    const apagada = await valorPorNombre(dueno, "MARCAS_DE_TARJETA", "Cabal Argentina");
    exito(
      await listas.reactivarValorDeLista(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        valorId: cabal.id,
        versionEsperada: apagada.version,
      }),
    );
    expect(await marcasOfrecidas(m)).toContain("Cabal Argentina");
    expect((await cobrarConMarca(m, cabal.id)).ok).toBe(true);
    expect(await marcasCobradas(m)).toHaveLength(2);
  });
});
