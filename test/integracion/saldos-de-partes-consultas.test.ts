import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import { armarTxDeSaldos } from "../../src/composicion/libro-de-saldos";
import {
  ERRORES_DEL_LIBRO,
  anularAsientoEnTx,
  cargosAbiertos,
  creditosAbiertos,
  estadoDeCuenta,
  imputarEnTx,
  registrarAsientoEnTx,
  saldoDeParte,
  saldoPorCentroDeCosto,
  traducirErroresDelLibro,
  type EntradaDeAsiento,
  type ErrorDelLibro,
  type Reparto,
  type TxDeSaldos,
} from "../../src/modulos/saldos_de_partes/publico";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  importeATexto,
  importeDesdeTexto,
  sumar,
  type Importe,
} from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, sumarDiasCiviles } from "../../src/primitivas/tiempo/fecha-civil";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearMundo, type Mundo } from "./fiscal-apoyo";
import { sufijoUnico } from "./unicos";

/**
 * LB-4b: las consultas del libro de saldos (`saldoDeParte`, `saldoPorCentroDeCosto`, `estadoDeCuenta`, `cargosAbiertos`, `creditosAbiertos`) contra la
 * base real (0092). Previene: un estado de cuenta cuya suma no es el saldo, un recorte por fechas que falsea el saldo corrido, un cargo anulado o
 * saldado que sigue «abierto», una «vencida» que se calcula con el día equivocado y una parte de otra empresa que se ve.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const CARGO = "CARGO_DE_FACTURA_DE_COMPRA";
const PAGO = "PAGO_A_PROVEEDOR";
const imp = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const fecha = (texto: string) => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const HOY = fecha("2026-11-21");

describe.skipIf(base === null)("consultas del libro de saldos contra la base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;
  let norte: string;
  let sur: string;
  let entorno: ReturnType<typeof crearEntorno>;

  const crearEntorno = (url: string, clave: NonNullable<typeof base>["clave"]) =>
    crearTransacciones<TxDeSaldos>({
      urls: { OPERATIVO: url },
      armar: armarTxDeSaldos,
      maximoDeConexiones: 4,
      clave,
    });

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
    const sucursal = async (nombre: string) =>
      (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
          [m.empresa, nombre],
        )
      ).rows[0]?.id as string;
    norte = await sucursal("Norte");
    sur = await sucursal("Sur");
    entorno = crearEntorno(propia.base.app, propia.base.clave);
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const contextoDe = (mundo: Mundo): ContextoOperativo => ({
    ...comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
    ahora: new Date("2026-11-21T15:00:00Z"),
  });
  const correr = async <T>(
    trabajo: (tx: TxDeSaldos) => Promise<Resultado<T, ErrorDelLibro>>,
    mundo: Mundo = m,
  ): Promise<Resultado<T, ErrorDelLibro | ErrorDePersistencia>> =>
    traducirErroresDelLibro(
      await entorno.ejecutar({ contexto: contextoDe(mundo), aislamiento: "serializable" }, trabajo),
      ERRORES_DEL_LIBRO,
    );
  const exito = <T>(r: Resultado<T, unknown>): T => {
    if (!r.ok) throw new Error(`falló: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const leer = <T>(trabajo: (tx: TxDeSaldos) => Promise<T>, mundo: Mundo = m): Promise<T> =>
    correr(async (tx) => ({ ok: true as const, valor: await trabajo(tx) }), mundo).then(exito);

  const crearParte = async (mundo: Mundo = m): Promise<string> => {
    const id = randomUUID();
    await dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4)`,
      [id, mundo.empresa, `Proveedor ${sufijoUnico()}`, mundo.persona],
    );
    return id;
  };
  const reparto = (importe: Importe, sucursal: string | null): Reparto[] => [
    { centroDeCosto: sucursal, importe },
  ];
  const cargo = (
    parte: string,
    importe: string,
    c: Partial<EntradaDeAsiento> = {},
  ): EntradaDeAsiento => ({
    parteId: parte,
    sentido: "A_PAGAR",
    clase: CARGO,
    importe: imp(importe),
    origen: { tipo: "compras.factura", id: randomUUID() },
    clave: randomUUID(),
    hechoEn: new Date("2026-11-21T12:00:00Z"),
    distribucion: reparto(imp(importe), m.sucursal),
    ...c,
  });
  const pago = (
    parte: string,
    importe: string,
    c: Partial<EntradaDeAsiento> = {},
  ): EntradaDeAsiento => ({
    parteId: parte,
    sentido: "A_PAGAR",
    clase: PAGO,
    importe: imp(`-${importe}`),
    origen: { tipo: "compras.pago", id: randomUUID() },
    clave: randomUUID(),
    hechoEn: new Date("2026-11-21T12:00:00Z"),
    distribucion: reparto(imp(`-${importe}`), m.sucursal),
    ...c,
  });
  const registrar = async (e: EntradaDeAsiento) =>
    exito(await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), e))).asientoId;
  const imputar = async (saldante: string, saldado: string, importe: string) =>
    exito(
      await correr((tx) =>
        imputarEnTx(tx, contextoDe(m), {
          saldanteId: saldante,
          repartos: [{ saldadoId: saldado, importe: imp(importe) }],
          clave: randomUUID(),
        }),
      ),
    );

  const cargos = (parte: string, mundo: Mundo = m) =>
    leer((tx) => cargosAbiertos(tx, contextoDe(mundo), parte, "A_PAGAR", HOY), mundo);
  const creditos = (parte: string, mundo: Mundo = m) =>
    leer((tx) => creditosAbiertos(tx, contextoDe(mundo), parte, "A_PAGAR"), mundo);
  const estado = (parte: string, mundo: Mundo = m, desde?: string, hasta?: string) =>
    leer(
      (tx) =>
        estadoDeCuenta(
          tx,
          contextoDe(mundo),
          parte,
          "A_PAGAR",
          desde === undefined ? undefined : fecha(desde),
          hasta === undefined ? undefined : fecha(hasta),
        ),
      mundo,
    );
  const saldo = (parte: string, mundo: Mundo = m) =>
    leer((tx) => saldoDeParte(tx, contextoDe(mundo), parte, "A_PAGAR"), mundo);

  describe("cargosAbiertos y «vencida»", () => {
    it("van por vencimiento (sin vencimiento al final), marcan «vencida» sin bloquear, y lo saldado o anulado sale", async () => {
      const parte = await crearParte();
      const vencida = await registrar(cargo(parte, "100.00", { venceEl: fecha("2026-11-10") }));
      const venceHoy = await registrar(cargo(parte, "200.00", { venceEl: fecha("2026-11-21") }));
      const futura = await registrar(cargo(parte, "300.00", { venceEl: fecha("2026-12-01") }));
      const sinFecha = await registrar(cargo(parte, "400.00"));
      const anulada = await registrar(cargo(parte, "500.00", { venceEl: fecha("2026-11-05") }));
      exito(
        await correr((tx) =>
          anularAsientoEnTx(tx, contextoDe(m), {
            asientoId: anulada,
            detalle: "Factura duplicada",
            clave: randomUUID(),
          }),
        ),
      );

      const abiertos = await cargos(parte);
      expect(abiertos.map((c) => c.asientoId)).toEqual([vencida, venceHoy, futura, sinFecha]);
      // Hoy = vencimiento NO es vencida; un día antes sí; sin vencimiento, nunca.
      expect(abiertos.map((c) => c.vencida)).toEqual([true, false, false, false]);
      expect(abiertos.map((c) => importeATexto(c.pendiente))).toEqual([
        "100.00",
        "200.00",
        "300.00",
        "400.00",
      ]);

      // Un pago imputado a medias baja lo pendiente; imputado del todo, el cargo sale.
      const p = await registrar(pago(parte, "150.00"));
      await imputar(p, vencida, "100.00");
      await imputar(p, venceHoy, "50.00");
      const despues = await cargos(parte);
      expect(despues.map((c) => c.asientoId)).toEqual([venceHoy, futura, sinFecha]);
      expect(importeATexto(despues[0]?.pendiente ?? imp("0.00"))).toBe("150.00");
      expect(importeATexto(despues[0]?.imputado ?? imp("0.00"))).toBe("50.00");
      expect(importeATexto(despues[0]?.tope ?? imp("0.00"))).toBe("200.00");
    });
  });

  describe("creditosAbiertos", () => {
    it("lista los saldos a favor con lo que les queda; aplicado del todo, sale; un cargo no es un crédito", async () => {
      const parte = await crearParte();
      const factura = await registrar(cargo(parte, "1000.00", { venceEl: fecha("2026-12-31") }));
      const aCuenta = await registrar(pago(parte, "300.00"));
      expect((await creditos(parte)).map((c) => importeATexto(c.pendiente))).toEqual(["300.00"]);
      expect((await creditos(parte))[0]?.asientoId).toBe(aCuenta);

      await imputar(aCuenta, factura, "100.00");
      expect((await creditos(parte)).map((c) => importeATexto(c.pendiente))).toEqual(["200.00"]);
      await imputar(aCuenta, factura, "200.00");
      expect(await creditos(parte)).toEqual([]);
      expect((await cargos(parte)).map((c) => importeATexto(c.pendiente))).toEqual(["700.00"]);
    });
  });

  describe("estadoDeCuenta", () => {
    it("trae cada asiento con su signo y el saldo corrido; su suma es saldoDeParte; la anulación es una línea propia", async () => {
      const parte = await crearParte();
      const f1 = await registrar(cargo(parte, "100.00"));
      await registrar(cargo(parte, "250.50"));
      await registrar(pago(parte, "50.25"));
      exito(
        await correr((tx) =>
          anularAsientoEnTx(tx, contextoDe(m), {
            asientoId: f1,
            detalle: "Factura duplicada",
            clave: randomUUID(),
          }),
        ),
      );

      const lineas = await estado(parte);
      expect(lineas).toHaveLength(4);
      // Los importes llevan su signo (el pago resta; el espejo niega a su original) y el corrido es la suma hasta esa línea.
      const suma = lineas.reduce((acum, l) => sumar(acum, l.importe), imp("0.00"));
      expect(importeATexto(suma)).toBe(importeATexto(await saldo(parte)));
      expect(importeATexto(suma)).toBe("200.25");
      expect(importeATexto(lineas[lineas.length - 1]?.saldoAcumulado ?? imp("0.00"))).toBe(
        "200.25",
      );
      const espejo = lineas.find((l) => l.naturaleza === "ANULACION");
      expect(espejo?.anulaA).toBe(f1);
      expect(importeATexto(espejo?.importe ?? imp("0.00"))).toBe("-100.00");
      // El corrido de cada línea es la suma acumulada de las anteriores.
      let corrido = imp("0.00");
      for (const l of lineas) {
        corrido = sumar(corrido, l.importe);
        expect(importeATexto(l.saldoAcumulado)).toBe(importeATexto(corrido));
      }
    });

    it("el recorte por fechas devuelve menos líneas pero el saldo corrido sigue siendo el real", async () => {
      const parte = await crearParte();
      await registrar(cargo(parte, "100.00"));
      await registrar(cargo(parte, "40.00"));
      const todas = await estado(parte);
      const dia = todas[0]?.fechaNegocio;
      if (dia === undefined) throw new Error("sin líneas");
      const ayer = sumarDiasCiviles(dia, -1);
      const manana = sumarDiasCiviles(dia, 1);
      if (!ayer.ok || !manana.ok) throw new Error("fecha");

      expect(await estado(parte, m, dia, dia)).toHaveLength(2);
      expect(await estado(parte, m, undefined, ayer.valor)).toEqual([]);
      expect(await estado(parte, m, manana.valor)).toEqual([]);
      const recortada = await estado(parte, m, dia, undefined);
      expect(recortada.map((l) => importeATexto(l.saldoAcumulado))).toEqual(
        todas.map((l) => importeATexto(l.saldoAcumulado)),
      );
    });
  });

  describe("saldoPorCentroDeCosto", () => {
    it("el desglose suma exactamente el saldo de la parte", async () => {
      const parte = await crearParte();
      await registrar(cargo(parte, "100.01", { distribucion: reparto(imp("100.01"), norte) }));
      await registrar(cargo(parte, "50.00", { distribucion: reparto(imp("50.00"), sur) }));
      await registrar(cargo(parte, "9.99", { distribucion: reparto(imp("9.99"), null) }));
      await registrar(pago(parte, "20.00", { distribucion: reparto(imp("-20.00"), norte) }));

      const desglose = await leer((tx) =>
        saldoPorCentroDeCosto(tx, contextoDe(m), parte, "A_PAGAR"),
      );
      expect(desglose.length).toBeGreaterThanOrEqual(3);
      const suma = desglose.reduce((acum, r) => sumar(acum, r.importe), imp("0.00"));
      expect(importeATexto(suma)).toBe(importeATexto(await saldo(parte)));
      expect(importeATexto(suma)).toBe("140.00");
    });
  });

  describe("aislamiento entre empresas", () => {
    it("una parte de otra empresa no se ve: saldo cero y listas vacías, sin diferencia con una parte inexistente", async () => {
      const parte = await crearParte();
      await registrar(cargo(parte, "100.00", { venceEl: fecha("2026-11-01") }));
      await registrar(pago(parte, "10.00"));

      expect(importeATexto(await saldo(parte, otra))).toBe("0.00");
      expect(await estado(parte, otra)).toEqual([]);
      expect(await cargos(parte, otra)).toEqual([]);
      expect(await creditos(parte, otra)).toEqual([]);
      expect(
        await leer((tx) => saldoPorCentroDeCosto(tx, contextoDe(otra), parte, "A_PAGAR"), otra),
      ).toEqual([]);

      const inexistente = randomUUID();
      expect(importeATexto(await saldo(inexistente))).toBe("0.00");
      expect(await estado(inexistente)).toEqual([]);
      expect(await cargos("no-es-un-uuid")).toEqual([]);
    });
  });
});
