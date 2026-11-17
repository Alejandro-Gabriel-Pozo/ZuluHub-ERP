import { describe, expect, it } from "vitest";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import {
  contextoDeParidad,
  guardDejoPasar,
  reglasDondeElOperadorPuedeSolo,
  vigilar,
} from "../../../../test/utilidades/paridad-del-guard";
import { crearCasosDeUsoDeSalon } from "./casos-de-uso";
import type { TxDeSalon } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * D4 (auditoría de salón): lo que el guard de cada caso de uso exige es EXACTAMENTE lo que su declaración dice (`accion` y `tambien`). Para cada caso: con solo las acciones
 * declaradas el guard deja pasar; quitando de a una, devuelve `SIN_PERMISO` sin tocar nada más. Sin base de datos: la transacción está vigilada.
 * Previene: la declaración dice `mesas.ver`/`comandas.enviar` mientras el guard exige `cuentas.*`, o el guard de una puerta exige menos que el de la otra.
 */

const ENTRADA = {} as never; // el guard va primero: ninguna entrada se lee antes de autorizar

type Casos = ReturnType<typeof crearCasosDeUsoDeSalon>;
const LLAMADAS: Record<keyof typeof DECLARACIONES, (c: Casos) => Promise<unknown>> = {
  crearMesa: (c) => c.crearMesa(contextoDeParidad, ENTRADA),
  editarMesa: (c) => c.editarMesa(contextoDeParidad, ENTRADA),
  desactivarMesa: (c) => c.desactivarMesa(contextoDeParidad, ENTRADA),
  reactivarMesa: (c) => c.reactivarMesa(contextoDeParidad, ENTRADA),
  tomarPedido: (c) => c.tomarPedido(contextoDeParidad, ENTRADA),
  agregarAlPedido: (c) => c.agregarAlPedido(contextoDeParidad, ENTRADA),
  liberarMesa: (c) => c.liberarMesa(contextoDeParidad, ENTRADA),
  cambiarDeMesa: (c) => c.cambiarDeMesa(contextoDeParidad, ENTRADA),
  cobrarMesa: (c) => c.cobrarMesa(contextoDeParidad, ENTRADA),
  enviarACocina: (c) => c.enviarACocina(contextoDeParidad, ENTRADA),
  pedirQueSalga: (c) => c.pedirQueSalga(contextoDeParidad, ENTRADA),
  anularItemEnviado: (c) => c.anularItemEnviado(contextoDeParidad, ENTRADA),
  unirMesas: (c) => c.unirMesas(contextoDeParidad, ENTRADA),
  dividirCuenta: (c) => c.dividirCuenta(contextoDeParidad, ENTRADA),
};

const llamar = (nombre: keyof typeof DECLARACIONES, puede: readonly string[]) => {
  const vigilada = vigilar<TxDeSalon>();
  const casos = crearCasosDeUsoDeSalon({
    transacciones: { ejecutar: (_o, trabajo) => trabajo(vigilada.tx) },
    reglas: reglasDondeElOperadorPuedeSolo(puede as never),
  });
  return { vigilada, llamada: LLAMADAS[nombre](casos) };
};

const nombres = Object.keys(DECLARACIONES) as (keyof typeof DECLARACIONES)[];

describe("D4: el guard de cada caso de uso del salón exige exactamente lo que declara", () => {
  it.each(nombres)("%s: con solo las acciones declaradas, el guard deja pasar", async (nombre) => {
    const { llamada } = llamar(nombre, accionesDeCaso(DECLARACIONES[nombre]));
    expect(await guardDejoPasar(llamada)).toBe(true);
  });

  const faltantes = nombres.flatMap((nombre) =>
    accionesDeCaso(DECLARACIONES[nombre]).map((falta) => ({ nombre, falta })),
  );
  it.each(faltantes)(
    "$nombre: sin $falta da SIN_PERMISO y no toca nada más",
    async ({ nombre, falta }) => {
      const resto = accionesDeCaso(DECLARACIONES[nombre]).filter((a) => a !== falta);
      const { vigilada, llamada } = llamar(nombre, resto);
      expect(await guardDejoPasar(llamada)).toBe(false);
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it("la lista de llamadas cubre todos los casos declarados", () => {
    expect(Object.keys(LLAMADAS).sort()).toEqual([...nombres].sort());
  });
});
