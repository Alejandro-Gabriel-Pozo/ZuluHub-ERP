import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Transacciones } from "../../src/puertos/transacciones";
import { crearCasosDeUsoDeComandas, type TxDeComandas } from "../../src/modulos/comandas/publico";
import type { EscenarioDeVentas } from "./ventas-apoyo";
import { nuevoId, valorDe } from "./ventas-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";

/**
 * E7 (T11), lo comercial (DEC-0201): el salón es un EXTRA de pago (perilla `salon`, apagada de base) y las comandas van en todos los planes. Sin la
 * perilla no se opera ni se lee el salón (todo comando y toda consulta lo dicen igual: `FUNCION_NO_INCLUIDA`), y las comandas siguen funcionando;
 * con la perilla, el salón opera. Se prueba con los casos de uso reales y el rol de la aplicación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SIN_PERILLA = { error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "salon" }, ok: false };

describe.skipIf(base === null)("salón: la perilla comercial", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const crearMesa = (id = nuevoId()) =>
    m.salon.crearMesa(e.gerente, {
      mesaId: id,
      sucursalId: e.sucursal,
      numero: 1,
      forma: "CUADRADA",
      tamano: "CHICA",
      columna: 1,
      fila: 1,
    });

  it("sin la perilla `salon` no se opera ni se lee el salón, y las comandas sí funcionan", async () => {
    m.perillaSalon(false);
    const id = nuevoId();
    expect(await crearMesa(id)).toEqual(SIN_PERILLA);
    expect(await m.contar("select count(*) as n from mesa where id = $1", [id])).toBe(0);
    expect(await m.consultasDeSalon.listarMesas(e.gerente, { sucursalId: e.sucursal })).toEqual(
      SIN_PERILLA,
    );
    // Las comandas no piden perilla: configurar una impresora anda igual.
    const comandas = crearCasosDeUsoDeComandas({
      transacciones: m.entorno as unknown as Transacciones<TxDeComandas>,
      reglas: m.reglas,
    });
    const impresora = await comandas.registrarImpresora(e.gerente, {
      impresoraId: nuevoId(),
      sucursalId: e.sucursal,
      nombre: "Cocina",
      uso: "COMANDA",
      papelMm: 80,
    });
    expect(valorDe(impresora)).toMatchObject({ yaExistia: false });
  });

  it("con la perilla encendida el salón opera, y apagarla de nuevo lo corta en la acción siguiente (sin caché)", async () => {
    m.perillaSalon(true);
    const id = nuevoId();
    expect(valorDe(await crearMesa(id))).toMatchObject({ yaExistia: false });
    expect(
      valorDe(await m.consultasDeSalon.listarMesas(e.gerente, { sucursalId: e.sucursal })),
    ).toHaveLength(1);
    m.perillaSalon(false);
    expect(await m.consultasDeSalon.listarMesas(e.gerente, { sucursalId: e.sucursal })).toEqual(
      SIN_PERILLA,
    );
    expect(await crearMesa(id)).toEqual(SIN_PERILLA);
    m.perillaSalon(true);
  });
});
