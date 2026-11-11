import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  anularItemEnviadoEnTx,
  copiarEstadoDeComandaEnTx,
  enviarACocinaEnTx,
  pedirQueSalgaEnTx,
  estadoDeComandaDeLineas,
  platosPendientesEnTx,
  registrarLineaDeComandaEnTx,
  resumenDeComandasPorCuentas,
  type ErrorDeComandas,
  type TxDeComandas,
} from "../../src/modulos/comandas/publico";
import { anularLineaEnTx, copiarLineaEnTx } from "../../src/modulos/ventas/publico";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { montarComandas, type MundoDeComandas } from "./comandas-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7-T5: lo que el salón usa de comandas DENTRO de su transacción (registrar la línea, el estado de cada plato, los platos pendientes que frenan el cobro,
 * copiar el estado al unir o dividir y el resumen de varias mesas en una consulta), con el rol real de la aplicación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

describe.skipIf(base === null)("comandas: las funciones EnTx del salón", () => {
  let m: MundoDeComandas;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarComandas(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const enTx = <T, E>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeComandas, persona: ReturnType<typeof personaId>) => Promise<Resultado<T, E>>,
  ) =>
    m.entorno.ejecutar({ contexto, reintentos: 10 }, (tx) =>
      trabajo(tx as unknown as TxDeComandas, personaId(contexto.personaId as string)),
    );

  it("registrar la línea es idempotente, cambia la salida solo sin enviar y el estado sale de la base", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2);
    const [a, b] = lineas as [string, string];
    const registrar = (linea: string, salida: "AHORA" | "DESPUES") =>
      enTx(e.gerente, (tx) =>
        registrarLineaDeComandaEnTx(tx, e.gerente, { cuentaId: cuenta, lineaId: linea, salida }),
      );
    expect(valorDe(await registrar(a, "AHORA"))).toEqual({ yaExistia: false });
    expect(valorDe(await registrar(a, "AHORA"))).toEqual({ yaExistia: true });
    expect(valorDe(await registrar(b, "DESPUES"))).toEqual({ yaExistia: false });
    expect(valorDe(await registrar(b, "AHORA"))).toEqual({ yaExistia: false });
    const pendientes = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(await platosPendientesEnTx(tx, e.gerente.empresaId, cuenta)),
      ),
    );
    expect(pendientes).toEqual({ paraEnviar: 2, enEspera: 0, puedeCobrarse: false });
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: b,
        salida: "DESPUES",
      }),
    );
    valorDe(
      await m.casosDeComandas.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 5",
        claveIdempotencia: nuevaClave(),
      }),
    );
    const estado = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(await estadoDeComandaDeLineas(tx, e.gerente.empresaId, cuenta)),
      ),
    );
    const de = (id: string) => estado.find((l) => l.lineaId === id);
    expect(de(a)).toMatchObject({ salida: "AHORA", numeroDeEnvio: 1 });
    expect(de(b)).toMatchObject({ salida: "DESPUES", envioId: null, numeroDeEnvio: null });
    // La enviada no cambia de salida; con un plato en espera todavía no se cobra.
    expect((await registrar(a, "DESPUES")).ok).toBe(false);
    const p = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(await platosPendientesEnTx(tx, e.gerente.empresaId, cuenta)),
      ),
    );
    expect(p).toEqual({ paraEnviar: 0, enEspera: 1, puedeCobrarse: false });
    // Una línea vigente SIN fila (agregada por otro camino) cuenta como «para enviar»: nunca se cobra a ciegas.
    const sola = nuevoId();
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: sola,
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    const q = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(await platosPendientesEnTx(tx, e.gerente.empresaId, cuenta)),
      ),
    );
    expect(q.paraEnviar).toBe(1);
  });

  it("copiar el estado conserva el envío de la línea enviada (no se reimprime) y el resumen de varias mesas sale en una consulta", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    const destino = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: destino, sucursalId: e.sucursal }));
    const envio = valorDe(
      await m.casosDeComandas.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 5",
        claveIdempotencia: nuevaClave(),
      }),
    );
    const nueva = nuevoId();
    valorDe(
      await enTx(e.gerente, async (tx, persona) => {
        const an = await anularLineaEnTx(tx, e.gerente, persona, {
          cuentaId: cuenta,
          lineaId: linea,
          motivo: "TRASLADADA",
        });
        if (!an.ok) return an;
        const c = await copiarLineaEnTx(tx, e.gerente, persona, {
          lineaOrigenId: linea,
          cuentaDestinoId: destino,
          lineaNuevaId: nueva,
          cantidad: "1",
          modo: "COMPLETA",
        });
        if (!c.ok) return c;
        return copiarEstadoDeComandaEnTx(tx, e.gerente, {
          lineaOrigenId: linea,
          lineaNuevaId: nueva,
          cuentaDestinoId: destino,
        });
      }),
    );
    const fila = await m.filas<{ envio_id: string | null; cuenta_id: string }>(
      "select envio_id, cuenta_id from linea_de_comanda where linea_id = $1",
      [nueva],
    );
    expect(fila[0]).toEqual({ envio_id: envio.envioId, cuenta_id: destino });
    // Ni se reenvía ni cuenta como pendiente en la cuenta destino.
    expect(
      valorDe(
        await enTx(e.gerente, async (tx) =>
          ok(await platosPendientesEnTx(tx, e.gerente.empresaId, destino)),
        ),
      ).puedeCobrarse,
    ).toBe(true);
    expect(
      (
        await m.casosDeComandas.enviarACocina(e.gerente, {
          envioId: nuevoId(),
          cuentaId: destino,
          rotulo: "Mesa 6",
          claveIdempotencia: nuevaClave(),
        })
      ).ok,
    ).toBe(false);
    const resumen = valorDe(
      await enTx(e.gerente, async (tx) =>
        ok(
          await resumenDeComandasPorCuentas(tx, e.gerente.empresaId, [cuenta, destino, "no-uuid"]),
        ),
      ),
    );
    // La cuenta destino no tuvo envíos propios, pero lo que heredó ya salió a cocina: cuenta el envío del que viene.
    expect(resumen.get(destino)).toEqual({ paraEnviar: 0, enEspera: 0, envios: 1 });
    expect(resumen.get(cuenta)).toEqual({ paraEnviar: 0, enEspera: 0, envios: 1 });
    expect(resumen.size).toBe(2);
  });

  it("enviar, pedir que salga y anular un ítem enviado, sin guard, dentro de la transacción del salón: el rótulo lo pone quien llama y todo es atómico", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2, "2");
    const [a, b] = lineas as [string, string];
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: b,
        salida: "DESPUES",
      }),
    );
    const envioId = nuevoId();
    const clave = nuevaClave();
    const avisoId = nuevoId();
    const hecho = valorDe(
      await enTx(e.gerente, async (tx, persona) => {
        const envio = await enviarACocinaEnTx(tx, e.gerente, persona, {
          envioId,
          cuentaId: cuenta,
          rotulo: "Mesa 12",
          claveIdempotencia: clave,
        });
        if (!envio.ok) return envio;
        const salida = await pedirQueSalgaEnTx(tx, e.gerente, persona, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          lineaIds: [b],
          rotulo: "Mesa 12",
          claveIdempotencia: nuevaClave(),
        });
        if (!salida.ok) return salida;
        const anulado = await anularItemEnviadoEnTx(tx, e.gerente, persona, {
          cuentaId: cuenta,
          lineaId: a,
          cantidad: "1",
          motivo: "Error del mozo",
          avisoId,
          rotulo: "Mesa 12",
        });
        return anulado.ok
          ? ok({ envio: envio.valor, salida: salida.valor, anulado: anulado.valor })
          : anulado;
      }),
    );
    expect(hecho.envio).toMatchObject({ envioId, numero: 1 });
    expect(hecho.salida).toMatchObject({ numero: 2, tipo: "SALIDA_PEDIDA" });
    expect(hecho.anulado).toMatchObject({ avisoId, quedan: "1.0000" });
    const rotulos = await m.filas<{ rotulo: string }>(
      "select rotulo from envio_de_comanda where cuenta_id = $1 order by numero",
      [cuenta],
    );
    expect(rotulos.map((r) => r.rotulo)).toEqual(["Mesa 12", "Mesa 12"]);
    // Una falla después de enviar revierte el envío entero (todo o nada).
    const otra = await m.cuentaConLineas(e, 1);
    const falla = await enTx<never, ErrorDeComandas | "FALLA_INYECTADA">(
      e.gerente,
      async (tx, persona) => {
        const envio = await enviarACocinaEnTx(tx, e.gerente, persona, {
          envioId: nuevoId(),
          cuentaId: otra.cuenta,
          rotulo: "Mesa 13",
          claveIdempotencia: nuevaClave(),
        });
        return envio.ok ? err("FALLA_INYECTADA" as const) : envio;
      },
    );
    expect(falla.ok).toBe(false);
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [
        otra.cuenta,
      ]),
    ).toBe(0);
    expect(
      await m.contar("select count(*) as n from contador_de_envios where cuenta_id = $1", [
        otra.cuenta,
      ]),
    ).toBe(0);
  });
});
