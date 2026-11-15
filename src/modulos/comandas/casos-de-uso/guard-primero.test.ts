import { describe, expect, it } from "vitest";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import {
  contextoDeParidad,
  guardDejoPasar,
  reglasDondeElOperadorPuedeSolo,
  vigilar,
} from "../../../../test/utilidades/paridad-del-guard";
import { crearCasosDeUsoDeComandas } from "./casos-de-uso";
import type { TxDeComandas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * D4 (auditoría de salón), puerta de comandas: lo que el guard de cada caso de uso exige es EXACTAMENTE lo que su declaración dice. Anular parte de un ítem enviado agrega
 * una línea (el resto): por esta puerta exigía menos (`cuentas.anular_linea`) que por la del salón. Sin base de datos: la transacción está vigilada.
 */

const ENTRADA = {} as never; // el guard va primero: ninguna entrada se lee antes de autorizar

type Casos = ReturnType<typeof crearCasosDeUsoDeComandas>;
const LLAMADAS: Record<keyof typeof DECLARACIONES, (c: Casos) => Promise<unknown>> = {
  enviarACocina: (c) => c.enviarACocina(contextoDeParidad, ENTRADA),
  pedirQueSalga: (c) => c.pedirQueSalga(contextoDeParidad, ENTRADA),
  anularItemEnviado: (c) => c.anularItemEnviado(contextoDeParidad, ENTRADA),
  quitarSinEnviar: (c) => c.quitarSinEnviar(contextoDeParidad, ENTRADA),
  cambiarSalida: (c) => c.cambiarSalida(contextoDeParidad, ENTRADA),
  registrarImpresora: (c) => c.registrarImpresora(contextoDeParidad, ENTRADA),
  editarImpresora: (c) => c.editarImpresora(contextoDeParidad, ENTRADA),
  desactivarImpresora: (c) => c.desactivarImpresora(contextoDeParidad, ENTRADA),
  solicitarImpresion: (c) => c.solicitarImpresion(contextoDeParidad, ENTRADA),
  solicitarCopia: (c) => c.solicitarCopia(contextoDeParidad, ENTRADA),
  declararResultadoDeImpresion: (c) => c.declararResultadoDeImpresion(contextoDeParidad, ENTRADA),
};

const llamar = (nombre: keyof typeof DECLARACIONES, puede: readonly string[]) => {
  const vigilada = vigilar<TxDeComandas>();
  const casos = crearCasosDeUsoDeComandas({
    transacciones: { ejecutar: (_o, trabajo) => trabajo(vigilada.tx) },
    reglas: reglasDondeElOperadorPuedeSolo(puede as never),
  });
  return { vigilada, llamada: LLAMADAS[nombre](casos) };
};

const nombres = Object.keys(DECLARACIONES) as (keyof typeof DECLARACIONES)[];

describe("D4: el guard de cada caso de uso de comandas exige exactamente lo que declara", () => {
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
