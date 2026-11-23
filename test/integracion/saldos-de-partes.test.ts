import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import {
  ERRORES_DEL_LIBRO,
  anularAsientoEnTx,
  conSigno,
  crearRepositorioDeAsientos,
  crearRepositorioDeImputaciones,
  crearRepositorioDeSaldos,
  deshacerImputacionEnTx,
  distribuirPorCentroDeCosto,
  imputarEnTx,
  registrarAsientoEnTx,
  traducirErroresDelLibro,
  type EntradaDeAsiento,
  type ErrorDelLibro,
  type Reparto,
  type SaldosDb,
  type TxDeSaldos,
} from "../../src/modulos/saldos_de_partes/publico";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  importeATexto,
  importeDesdeTexto,
  type Importe,
} from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { comoEmpresa, crearBarrera, crearBaseAparte } from "./entorno";
import { crearMundo, type Mundo } from "./fiscal-apoyo";
import { sufijoUnico } from "./unicos";

/**
 * LB-4a: el módulo `saldos_de_partes` contra la base real (0092), con el adaptador de transacciones de verdad (`serializable` con reintento
 * ante `40001` y `40P01`) y también en `read committed`. Registrar, imputar, deshacer y anular, con sus constancias de auditoría en la misma
 * transacción. Previene: un doble clic que duplica un asiento, dos pagos que juntos pasan lo adeudado, una anulación que se cruza con una
 * imputación, un «deshacer» que baja de cero, y un saldo que no suma sus asientos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const AISLAMIENTOS = ["serializable", "read committed"] as const;
type Aislamiento = (typeof AISLAMIENTOS)[number];
const CARGO = "CARGO_DE_FACTURA_DE_COMPRA";
const PAGO = "PAGO_A_PROVEEDOR";

const imp = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const fecha = (texto: string) => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};

describe.skipIf(base === null)("módulo saldos_de_partes contra la base real", () => {
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
      armar: (db) => {
        const tablas = db.withTables<SaldosDb & AuditoriaDb>();
        return {
          asientos: crearRepositorioDeAsientos(tablas),
          imputaciones: crearRepositorioDeImputaciones(tablas),
          saldos: crearRepositorioDeSaldos(tablas),
          auditoria: crearAuditoriaDePostgres(tablas),
        };
      },
      maximoDeConexiones: 8,
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

  // ---------------------------------------------------------------------------------------------
  // Apoyo
  // ---------------------------------------------------------------------------------------------
  const contextoDe = (mundo: Mundo, persona: string | null = mundo.persona): ContextoOperativo => ({
    ...comoEmpresa(empresaId(mundo.empresa), persona === null ? null : personaId(persona)),
    ahora: new Date("2026-11-21T15:00:00Z"),
  });

  const correr = async <T>(
    trabajo: (tx: TxDeSaldos) => Promise<Resultado<T, ErrorDelLibro>>,
    o: { aislamiento?: Aislamiento; mundo?: Mundo; persona?: string | null } = {},
  ): Promise<Resultado<T, ErrorDelLibro | ErrorDePersistencia>> => {
    const mundo = o.mundo ?? m;
    const r = await entorno.ejecutar(
      {
        contexto: contextoDe(mundo, o.persona === undefined ? mundo.persona : o.persona),
        aislamiento: o.aislamiento ?? "serializable",
      },
      trabajo,
    );
    return traducirErroresDelLibro(r, ERRORES_DEL_LIBRO);
  };
  const exito = <T>(r: Resultado<T, unknown>): T => {
    if (!r.ok) throw new Error(`falló: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const crearParte = async (mundo: Mundo = m): Promise<string> => {
    const id = randomUUID();
    await dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, $4)`,
      [id, mundo.empresa, `Proveedor ${sufijoUnico()}`, mundo.persona],
    );
    return id;
  };

  const todoAUno = (importe: Importe, sucursal: string | null): Reparto[] => [
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
    distribucion: todoAUno(imp(importe), m.sucursal),
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
    distribucion: todoAUno(imp(`-${importe}`), m.sucursal),
    ...c,
  });

  const registrar = async (e: EntradaDeAsiento, aislamiento: Aislamiento = "serializable") =>
    exito(await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), e), { aislamiento }))
      .asientoId;

  const imputar = (
    saldante: string,
    repartos: Array<[string, string]>,
    clave = randomUUID(),
    aislamiento: Aislamiento = "serializable",
  ) =>
    correr(
      (tx) =>
        imputarEnTx(tx, contextoDe(m), {
          saldanteId: saldante,
          repartos: repartos.map(([saldadoId, i]) => ({ saldadoId, importe: imp(i) })),
          clave,
        }),
      { aislamiento },
    );

  const leer = <T>(trabajo: (tx: TxDeSaldos) => Promise<T>, mundo: Mundo = m): Promise<T> =>
    correr(async (tx) => ({ ok: true as const, valor: await trabajo(tx) }), { mundo }).then(exito);
  const saldoDe = (parte: string): Promise<string> =>
    leer(async (tx) =>
      importeATexto(await tx.saldos.saldoDeParte(contextoDe(m).empresaId, parte, "A_PAGAR")),
    );
  const estadoDe = (id: string) =>
    leer(async (tx) => {
      const e = await tx.saldos.estadoDeAsiento(contextoDe(m).empresaId, id);
      return e === null
        ? null
        : { imputado: importeATexto(e.imputado), tope: importeATexto(e.tope), anulado: e.anulado };
    });
  const cuantos = async (tabla: string, donde: string, p: unknown[]): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          `select count(*)::text as n from ${tabla} where ${donde}`,
          p,
        )
      ).rows[0]?.n,
    );
  const constancias = async (entidadId: string) =>
    (
      await dueno.query<{ accion: string; entidad: string; despues: string; actor: string | null }>(
        `select accion, entidad, despues::text as despues, actor_persona_id::text as actor
           from auditoria_empresa where entidad_id = $1 order by 1`,
        [entidadId],
      )
    ).rows;

  // ---------------------------------------------------------------------------------------------
  describe("registrar un asiento", () => {
    it("guarda el asiento con su distribución, actualiza el saldo y el desglose, y deja su constancia en la misma transacción", async () => {
      const parte = await crearParte();
      const id = await registrar(
        cargo(parte, "10.00", {
          distribucion: [
            { centroDeCosto: m.sucursal, importe: imp("3.34") },
            { centroDeCosto: norte, importe: imp("3.33") },
            { centroDeCosto: sur, importe: imp("3.33") },
          ],
          venceEl: fecha("2026-12-10"),
        }),
      );
      expect(await saldoDe(parte)).toBe("10.00");
      const desglose = await leer(async (tx) =>
        (await tx.saldos.saldoPorCentroDeCosto(contextoDe(m).empresaId, parte, "A_PAGAR")).map(
          (r) => importeATexto(r.importe),
        ),
      );
      expect(desglose.sort()).toEqual(["3.33", "3.33", "3.34"]);
      expect(await estadoDe(id)).toEqual({ imputado: "0.00", tope: "10.00", anulado: false });
      const [c, ...resto] = await constancias(id);
      expect(resto).toEqual([]);
      expect(c).toMatchObject({
        accion: "saldos.registrar_asiento",
        entidad: "asiento_de_saldo",
        actor: m.persona,
      });
      const despues = JSON.parse(c?.despues ?? "{}") as Record<string, unknown>;
      expect(despues).toMatchObject({ importe: "10.00", clase: CARGO, venceEl: "2026-12-10" });
      expect(JSON.stringify(despues)).not.toMatch(/clave|huella/i);
    });

    it("la fecha de negocio la pone la base y el desglose por centro usa lo que calcula el dominio (a cuenta, proporcional)", async () => {
      const parte = await crearParte();
      await registrar(cargo(parte, "30.00", { distribucion: todoAUno(imp("30.00"), norte) }));
      await registrar(cargo(parte, "10.00", { distribucion: todoAUno(imp("10.00"), sur) }));
      const aCuenta = await leer(async (tx) => {
        const pendiente = (
          await tx.saldos.saldoPorCentroDeCosto(contextoDe(m).empresaId, parte, "A_PAGAR")
        ).map((r) => ({ centroDeCosto: r.centroDeCosto, pendiente: r.importe }));
        return distribuirPorCentroDeCosto({
          importe: imp("20.00"),
          imputaciones: [],
          pendientePorCentro: pendiente,
        });
      });
      const reparto = exito(aCuenta);
      const pagoId = await registrar(
        pago(parte, "20.00", { distribucion: conSigno(reparto, "-") }),
      );
      expect(await saldoDe(parte)).toBe("20.00");
      const filas = await dueno.query<{ fecha_negocio: string; importe: string }>(
        "select fecha_negocio::text, importe::text from asiento_de_saldo where id = $1",
        [pagoId],
      );
      expect(filas.rows[0]).toEqual({ fecha_negocio: "2026-11-21", importe: "-20.00" });
      // 20,00 «a cuenta» con pendientes 30 y 10: 15,00 y 5,00 (el desglose queda 15 + 5 = 20, la suma del saldo).
      expect(reparto.map((r) => importeATexto(r.importe)).sort()).toEqual(["15.00", "5.00"]);
    });

    it("rechaza lo inválido ANTES de escribir (sin tocar la base) y exige un actor", async () => {
      const parte = await crearParte();
      const antes = await cuantos("asiento_de_saldo", "parte_id = $1", [parte]);
      const r1 = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m), cargo(parte, "10.00", { clase: "INVENTADA" })),
      );
      expect(!r1.ok && r1.error).toBe("CLASE_NO_ADMITIDA");
      const r2 = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m, null), cargo(parte, "10.00")),
      );
      expect(!r2.ok && r2.error).toBe("ACTOR_REQUERIDO");
      expect(await cuantos("asiento_de_saldo", "parte_id = $1", [parte])).toBe(antes);
    });

    it("lo que solo la base ve se traduce a su error de negocio: parte inexistente, de otra empresa e inactiva", async () => {
      const inexistente = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m), cargo(randomUUID(), "10.00")),
      );
      expect(!inexistente.ok && inexistente.error).toBe("PARTE_NO_ENCONTRADA");
      const deOtra = await crearParte(otra);
      const ajena = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m), cargo(deOtra, "10.00")),
      );
      expect(!ajena.ok && ajena.error).toBe("PARTE_NO_ENCONTRADA");
      const inactiva = await crearParte();
      await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [inactiva]);
      const r = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m), cargo(inactiva, "10.00")),
      );
      expect(!r.ok && r.error).toBe("PARTE_INACTIVA");
      // Una parte inactiva SÍ admite lo que reduce la deuda.
      exito(await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), pago(inactiva, "5.00"))));
    });

    it("una distribución que suma mal falla al confirmar y no deja nada: ni el asiento ni el saldo", async () => {
      const parte = await crearParte();
      // La distribución se valida en el dominio; para llegar hasta la base se escribe por el repositorio directo.
      const id = randomUUID();
      const r = await correr(async (tx) => {
        const asientoId = await tx.asientos.insertar({
          empresa: contextoDe(m).empresaId,
          parteId: parte,
          sentido: "A_PAGAR",
          clase: CARGO,
          naturaleza: "ORIGINAL",
          importe: imp("10.00"),
          origenTipo: "compras.factura",
          origenId: id,
          origenOrden: 1,
          referenciaTipo: null,
          referenciaId: null,
          venceEl: null,
          detalle: null,
          anulaA: null,
          clave: randomUUID(),
          huella: "a".repeat(64),
          hechoEn: new Date("2026-11-21T12:00:00Z"),
          registradoPor: personaId(m.persona),
        });
        await tx.asientos.insertarDistribucion(contextoDe(m).empresaId, asientoId, [
          { centroDeCosto: norte, importe: imp("9.99") },
        ]);
        return { ok: true as const, valor: asientoId };
      });
      expect(!r.ok && r.error).toBe("DISTRIBUCION_INVALIDA");
      expect(await cuantos("asiento_de_saldo", "origen_id = $1", [id])).toBe(0);
      expect(await saldoDe(parte)).toBe("0.00");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("idempotencia", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`${aislamiento}: el mismo asiento dos veces (misma clave) es uno solo, un saldo y una constancia`, async () => {
        const parte = await crearParte();
        const e = cargo(parte, "25.00");
        const primero = exito(
          await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), e), { aislamiento }),
        );
        const segundo = exito(
          await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), e), { aislamiento }),
        );
        expect(primero.yaExistia).toBe(false);
        expect(segundo).toEqual({ asientoId: primero.asientoId, yaExistia: true });
        expect(await cuantos("asiento_de_saldo", "parte_id = $1", [parte])).toBe(1);
        expect(
          await cuantos("distribucion_de_asiento", "asiento_id = $1", [primero.asientoId]),
        ).toBe(1);
        expect(await saldoDe(parte)).toBe("25.00");
        expect((await constancias(primero.asientoId)).length).toBe(1);
      });
    }

    it("la misma clave con otro importe es CLAVE_REUTILIZADA y no escribe; el mismo origen con otra clave: el primero manda", async () => {
      const parte = await crearParte();
      const e = cargo(parte, "25.00");
      const primero = await registrar(e);
      const otroImporte = await correr((tx) =>
        registrarAsientoEnTx(tx, contextoDe(m), {
          ...e,
          importe: imp("26.00"),
          distribucion: todoAUno(imp("26.00"), m.sucursal),
        }),
      );
      expect(!otroImporte.ok && otroImporte.error).toBe("CLAVE_REUTILIZADA");
      const otraClave = exito(
        await correr((tx) =>
          registrarAsientoEnTx(tx, contextoDe(m), { ...e, clave: randomUUID() }),
        ),
      );
      expect(otraClave).toEqual({ asientoId: primero, yaExistia: true });
      expect(await cuantos("asiento_de_saldo", "parte_id = $1", [parte])).toBe(1);
      expect(await saldoDe(parte)).toBe("25.00");
    });

    for (const aislamiento of AISLAMIENTOS) {
      it(`${aislamiento}: dos pedidos iguales a la vez (doble clic) dejan UN asiento y un saldo exacto`, async () => {
        const parte = await crearParte();
        const e = cargo(parte, "40.00");
        const barrera = crearBarrera(2);
        const unoDeDos = () =>
          correr(
            async (tx) => {
              await barrera();
              return registrarAsientoEnTx(tx, contextoDe(m), e);
            },
            { aislamiento },
          );
        const [a, b] = await Promise.all([unoDeDos(), unoDeDos()]);
        // Cada uno devuelve el asiento (uno lo creó, el otro ya existía) o, en `read committed`, «otro pedido igual ganó» (se repite una vez).
        for (const r of [a, b]) {
          expect(r.ok || r.error === "CLAVE_YA_USADA" || r.error === "ORIGEN_YA_REGISTRADO").toBe(
            true,
          );
        }
        const reintento = exito(await correr((tx) => registrarAsientoEnTx(tx, contextoDe(m), e)));
        expect(reintento.yaExistia).toBe(true);
        expect(await cuantos("asiento_de_saldo", "parte_id = $1", [parte])).toBe(1);
        expect(await saldoDe(parte)).toBe("40.00");
      });
    }

    it("imputar y anular repetidos con la misma clave dejan un solo efecto; con otro pedido, CLAVE_REUTILIZADA", async () => {
      const parte = await crearParte();
      const f = await registrar(cargo(parte, "100.00"));
      const p = await registrar(pago(parte, "100.00"));
      const clave = randomUUID();
      const primera = exito(await imputar(p, [[f, "60.00"]], clave));
      const segunda = exito(await imputar(p, [[f, "60.00"]], clave));
      expect(primera.yaExistia).toBe(false);
      expect(segunda).toEqual({ imputacionIds: primera.imputacionIds, yaExistia: true });
      expect(await estadoDe(f)).toMatchObject({ imputado: "60.00" });
      const distinta = await imputar(p, [[f, "61.00"]], clave);
      expect(!distinta.ok && distinta.error).toBe("CLAVE_REUTILIZADA");
      expect(await estadoDe(f)).toMatchObject({ imputado: "60.00" });

      const claveAnular = randomUUID();
      const anular = () =>
        correr((tx) =>
          anularAsientoEnTx(tx, contextoDe(m), {
            asientoId: p,
            detalle: "Pago mal cargado",
            clave: claveAnular,
          }),
        );
      const a1 = exito(await anular());
      const a2 = exito(await anular());
      expect(a1.yaExistia).toBe(false);
      expect(a2).toMatchObject({ asientoId: a1.asientoId, yaExistia: true });
      expect(await cuantos("asiento_de_saldo", "anula_a = $1", [p])).toBe(1);
      const otroDetalle = await correr((tx) =>
        anularAsientoEnTx(tx, contextoDe(m), {
          asientoId: p,
          detalle: "Otro motivo",
          clave: claveAnular,
        }),
      );
      expect(!otroDetalle.ok && otroDetalle.error).toBe("CLAVE_REUTILIZADA");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("imputar y deshacer", () => {
    it("reparte entre varios cargos escribiendo SIEMPRE en orden ascendente de `saldado`, aunque lleguen al revés, y deja su constancia", async () => {
      const parte = await crearParte();
      const cargos = [
        await registrar(cargo(parte, "50.00")),
        await registrar(cargo(parte, "50.00")),
        await registrar(cargo(parte, "50.00")),
      ];
      const p = await registrar(pago(parte, "120.00"));
      const alReves = [...cargos].sort().reverse();
      const clave = randomUUID();
      const r = exito(
        await imputar(
          p,
          [
            [alReves[0] as string, "50.00"],
            [alReves[1] as string, "50.00"],
            [alReves[2] as string, "20.00"],
          ],
          clave,
        ),
      );
      const filas = await dueno.query<{ numero: number; saldado_id: string; importe: string }>(
        "select numero, saldado_id::text, importe::text from imputacion_de_saldo where clave_idempotencia = $1 order by numero",
        [clave],
      );
      expect(filas.rows.map((f) => f.saldado_id)).toEqual([...cargos].sort());
      expect(filas.rows.map((f) => f.numero)).toEqual([1, 2, 3]);
      // Los importes van con su cargo: el último en orden descendente (20,00) es el primero en orden ascendente.
      expect(filas.rows.map((f) => f.importe)).toEqual(["20.00", "50.00", "50.00"]);
      expect(await estadoDe(p)).toMatchObject({ imputado: "120.00" });
      const constancia = await constancias(r.imputacionIds[0] as string);
      expect(constancia).toHaveLength(1);
      expect(constancia[0]).toMatchObject({
        accion: "saldos.imputar",
        entidad: "imputacion_de_saldo",
      });
    });

    it("lo imputado nunca pasa el importe de un asiento: el tope lo impone la base y el error es CREDITO_INSUFICIENTE", async () => {
      const parte = await crearParte();
      const f = await registrar(cargo(parte, "100.00"));
      const p = await registrar(pago(parte, "80.00"));
      const sobrePago = await imputar(p, [[f, "80.01"]]);
      expect(!sobrePago.ok && sobrePago.error).toBe("CREDITO_INSUFICIENTE");
      const sobreFactura = await imputar(await registrar(pago(parte, "500.00")), [[f, "100.01"]]);
      expect(!sobreFactura.ok && sobreFactura.error).toBe("CREDITO_INSUFICIENTE");
      expect(await estadoDe(f)).toMatchObject({ imputado: "0.00" });
    });

    it("deshace total o parcialmente; no se deshace más de lo imputado ni un par que nunca se imputó", async () => {
      const parte = await crearParte();
      const f = await registrar(cargo(parte, "100.00"));
      const p = await registrar(pago(parte, "100.00"));
      exito(await imputar(p, [[f, "70.00"]]));
      const deshacer = (importe: string) =>
        correr((tx) =>
          deshacerImputacionEnTx(tx, contextoDe(m), {
            saldanteId: p,
            saldadoId: f,
            importe: imp(importe),
            clave: randomUUID(),
          }),
        );
      exito(await deshacer("30.00"));
      expect(await estadoDe(f)).toMatchObject({ imputado: "40.00" });
      const demasiado = await deshacer("40.01");
      expect(!demasiado.ok && demasiado.error).toBe("DESHACER_SUPERA_LO_IMPUTADO");
      exito(await deshacer("40.00"));
      expect(await estadoDe(f)).toMatchObject({ imputado: "0.00" });
      const otroPago = await registrar(pago(parte, "10.00"));
      const sinPar = await correr((tx) =>
        deshacerImputacionEnTx(tx, contextoDe(m), {
          saldanteId: otroPago,
          saldadoId: f,
          importe: imp("1.00"),
          clave: randomUUID(),
        }),
      );
      expect(!sinPar.ok && sinPar.error).toBe("DESHACER_SUPERA_LO_IMPUTADO");
    });

    it("no se imputa entre partes distintas, ni con asientos que no existen o son de otra empresa; ni con renglones mal armados", async () => {
      const p1 = await crearParte();
      const p2 = await crearParte();
      const f = await registrar(cargo(p1, "100.00"));
      const pagoDeOtraParte = await registrar(pago(p2, "100.00"));
      const cruzado = await imputar(pagoDeOtraParte, [[f, "10.00"]]);
      expect(!cruzado.ok && cruzado.error).toBe("IMPUTACION_INVALIDA");
      const inexistente = await imputar(randomUUID(), [[f, "10.00"]]);
      expect(!inexistente.ok && inexistente.error).toBe("ASIENTO_NO_ENCONTRADO");
      const deOtra = await crearParte(otra);
      const ajeno = exito(
        await correr(
          (tx) =>
            registrarAsientoEnTx(tx, contextoDe(otra), {
              ...pago(deOtra, "50.00"),
              distribucion: todoAUno(imp("-50.00"), otra.sucursal),
            }),
          { mundo: otra },
        ),
      ).asientoId;
      const deOtraEmpresa = await imputar(ajeno, [[f, "10.00"]]);
      expect(!deOtraEmpresa.ok && deOtraEmpresa.error).toBe("ASIENTO_NO_ENCONTRADO");
      const p = await registrar(pago(p1, "50.00"));
      for (const malos of [
        [],
        [[f, "0.00"]],
        [[f, "-5.00"]],
        [
          [f, "5.00"],
          [f, "5.00"],
        ],
        [["no-es-uuid", "5.00"]],
      ] as Array<Array<[string, string]>>) {
        const r = await imputar(p, malos);
        expect(!r.ok && r.error).toBe("IMPUTACION_INVALIDA");
      }
      // Cargo contra cargo (mismo signo): lo rechaza la base.
      const cargoContraCargo = await imputar(f, [[await registrar(cargo(p1, "10.00")), "5.00"]]);
      expect(!cargoContraCargo.ok && cargoContraCargo.error).toBe("IMPUTACION_INVALIDA");
    });

    it("una serie que falla a la mitad no deja ni el asiento ni la primera imputación (todo o nada)", async () => {
      const parte = await crearParte();
      const f = await registrar(cargo(parte, "100.00"));
      const pagoNuevo = pago(parte, "100.00");
      const r = await correr(async (tx) => {
        const registrado = await registrarAsientoEnTx(tx, contextoDe(m), pagoNuevo);
        if (!registrado.ok) return registrado;
        const primera = await imputarEnTx(tx, contextoDe(m), {
          saldanteId: registrado.valor.asientoId,
          repartos: [{ saldadoId: f, importe: imp("60.00") }],
          clave: randomUUID(),
        });
        if (!primera.ok) return primera;
        // La segunda pasa el tope del cargo: la base la rechaza y se revierte TODO.
        const segunda = await imputarEnTx(tx, contextoDe(m), {
          saldanteId: registrado.valor.asientoId,
          repartos: [{ saldadoId: f, importe: imp("60.00") }],
          clave: randomUUID(),
        });
        return segunda;
      });
      expect(!r.ok && r.error).toBe("CREDITO_INSUFICIENTE");
      expect(await cuantos("asiento_de_saldo", "origen_id = $1", [pagoNuevo.origen.id])).toBe(0);
      expect(await cuantos("imputacion_de_saldo", "saldado_id = $1", [f])).toBe(0);
      expect(await estadoDe(f)).toMatchObject({ imputado: "0.00" });
      expect(await saldoDe(parte)).toBe("100.00");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("anular un asiento", () => {
    it("sin imputaciones: inserta el espejo (misma clase y origen, importe invertido, distribución negada), el saldo y el desglose vuelven a cero", async () => {
      const parte = await crearParte();
      const f = await registrar(
        cargo(parte, "10.00", {
          distribucion: [
            { centroDeCosto: norte, importe: imp("6.00") },
            { centroDeCosto: null, importe: imp("4.00") },
          ],
        }),
      );
      const r = exito(
        await correr((tx) =>
          anularAsientoEnTx(tx, contextoDe(m), {
            asientoId: f,
            detalle: "Factura duplicada",
            clave: randomUUID(),
          }),
        ),
      );
      expect(r).toMatchObject({ yaExistia: false, imputacionesDeshechas: 0 });
      const espejo = await dueno.query<{
        naturaleza: string;
        clase: string;
        importe: string;
        anula_a: string;
        detalle: string;
      }>(
        "select naturaleza, clase, importe::text, anula_a::text, detalle from asiento_de_saldo where id = $1",
        [r.asientoId],
      );
      expect(espejo.rows[0]).toEqual({
        naturaleza: "ANULACION",
        clase: CARGO,
        importe: "-10.00",
        anula_a: f,
        detalle: "Factura duplicada",
      });
      expect(await saldoDe(parte)).toBe("0.00");
      for (const fila of await leer(async (tx) =>
        tx.saldos.saldoPorCentroDeCosto(contextoDe(m).empresaId, parte, "A_PAGAR"),
      )) {
        expect(importeATexto(fila.importe)).toBe("0.00");
      }
      expect(await estadoDe(f)).toMatchObject({ anulado: true });
      const [c] = await constancias(r.asientoId);
      expect(c).toMatchObject({ accion: "saldos.anular_asiento", actor: m.persona });
    });

    it("con imputaciones vigentes las deshace primero (todas) y después anula, en una transacción; el saldante y el saldado quedan en cero", async () => {
      const parte = await crearParte();
      const f1 = await registrar(cargo(parte, "100.00"));
      const f2 = await registrar(cargo(parte, "100.00"));
      const p = await registrar(pago(parte, "150.00"));
      exito(
        await imputar(p, [
          [f1, "100.00"],
          [f2, "50.00"],
        ]),
      );
      const r = exito(
        await correr((tx) =>
          anularAsientoEnTx(tx, contextoDe(m), {
            asientoId: p,
            detalle: "Pago mal cargado",
            clave: randomUUID(),
          }),
        ),
      );
      expect(r.imputacionesDeshechas).toBe(2);
      expect(await estadoDe(p)).toEqual({ imputado: "0.00", tope: "150.00", anulado: true });
      expect(await estadoDe(f1)).toMatchObject({ imputado: "0.00" });
      expect(await estadoDe(f2)).toMatchObject({ imputado: "0.00" });
      expect(await saldoDe(parte)).toBe("200.00");
      // Nada se borró: las imputaciones originales y sus deshaceres siguen en el libro.
      expect(await cuantos("imputacion_de_saldo", "saldante_id = $1", [p])).toBe(4);
    });

    it("no se anula dos veces, ni una anulación, ni algo que no existe o es de otra empresa; el detalle es obligatorio", async () => {
      const parte = await crearParte();
      const f = await registrar(cargo(parte, "10.00"));
      const anular = (asientoId: string, detalle: string, mundo: Mundo = m) =>
        correr(
          (tx) =>
            anularAsientoEnTx(tx, contextoDe(mundo), { asientoId, detalle, clave: randomUUID() }),
          { mundo },
        );
      const primero = exito(await anular(f, "Anulo"));
      const dos = await anular(f, "Anulo de nuevo");
      expect(!dos.ok && dos.error).toBe("ASIENTO_YA_ANULADO");
      const anulacion = await anular(primero.asientoId, "Anulo la anulación");
      expect(!anulacion.ok && anulacion.error).toBe("ESPEJO_INVALIDO");
      const inexistente = await anular(randomUUID(), "x");
      expect(!inexistente.ok && inexistente.error).toBe("ASIENTO_NO_ENCONTRADO");
      const deOtra = await anular(f, "Es de otra empresa", otra);
      expect(!deOtra.ok && deOtra.error).toBe("ASIENTO_NO_ENCONTRADO");
      const sinDetalle = await anular(await registrar(cargo(parte, "5.00")), "   ");
      expect(!sinDetalle.ok && sinDetalle.error).toBe("DETALLE_OBLIGATORIO");
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe("concurrencia (dos conexiones reales)", () => {
    for (const aislamiento of AISLAMIENTOS) {
      describe(aislamiento, () => {
        const ambos = async <A, B>(
          a: (tx: TxDeSaldos) => Promise<Resultado<A, ErrorDelLibro>>,
          b: (tx: TxDeSaldos) => Promise<Resultado<B, ErrorDelLibro>>,
        ) => {
          const barrera = crearBarrera(2);
          const con = <T>(paso: (tx: TxDeSaldos) => Promise<Resultado<T, ErrorDelLibro>>) =>
            correr(
              async (tx) => {
                await barrera();
                return paso(tx);
              },
              { aislamiento },
            );
          return Promise.all([con(a), con(b)]);
        };

        it("dos pagos a la vez que juntos exceden lo adeudado de una factura: uno imputa y el otro recibe CREDITO_INSUFICIENTE", async () => {
          const parte = await crearParte();
          const f = await registrar(cargo(parte, "100.00"));
          const p1 = await registrar(pago(parte, "80.00"));
          const p2 = await registrar(pago(parte, "80.00"));
          const imputa = (p: string) => (tx: TxDeSaldos) =>
            imputarEnTx(tx, contextoDe(m), {
              saldanteId: p,
              repartos: [{ saldadoId: f, importe: imp("80.00") }],
              clave: randomUUID(),
            });
          const [a, b] = await ambos(imputa(p1), imputa(p2));
          expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
          const perdedor = a.ok ? b : a;
          expect(!perdedor.ok && perdedor.error).toBe("CREDITO_INSUFICIENTE");
          expect(await estadoDe(f)).toMatchObject({ imputado: "80.00" });
        });

        it("dos pagos que caben los dos: imputan los dos y lo imputado es la suma exacta", async () => {
          const parte = await crearParte();
          const f = await registrar(cargo(parte, "100.00"));
          const p1 = await registrar(pago(parte, "30.00"));
          const p2 = await registrar(pago(parte, "30.00"));
          const imputa = (p: string) => (tx: TxDeSaldos) =>
            imputarEnTx(tx, contextoDe(m), {
              saldanteId: p,
              repartos: [{ saldadoId: f, importe: imp("30.00") }],
              clave: randomUUID(),
            });
          const [a, b] = await ambos(imputa(p1), imputa(p2));
          expect(a.ok && b.ok).toBe(true);
          expect(await estadoDe(f)).toMatchObject({ imputado: "60.00" });
        });

        it("dos movimientos a la vez sobre el mismo saldo (dos asientos de la misma parte): el saldo y el desglose son la suma exacta", async () => {
          const parte = await crearParte();
          const nuevo = (importe: string, sucursal: string) => (tx: TxDeSaldos) =>
            registrarAsientoEnTx(
              tx,
              contextoDe(m),
              cargo(parte, importe, { distribucion: todoAUno(imp(importe), sucursal) }),
            );
          const [a, b] = await ambos(nuevo("70.00", norte), nuevo("30.50", sur));
          expect(a.ok && b.ok).toBe(true);
          expect(await saldoDe(parte)).toBe("100.50");
          const centros = await leer(async (tx) =>
            tx.saldos.saldoPorCentroDeCosto(contextoDe(m).empresaId, parte, "A_PAGAR"),
          );
          const suma = centros.reduce(
            (acc, r) => acc + Number(importeATexto(r.importe).replace(".", "")),
            0,
          );
          expect(suma).toBe(10050);
        });

        it("anular un asiento e imputarlo a la vez: una sola gana y nunca queda imputado un asiento anulado", async () => {
          const parte = await crearParte();
          const f = await registrar(cargo(parte, "100.00"));
          const p = await registrar(pago(parte, "100.00"));
          const [anula, imputa] = await ambos(
            (tx) =>
              anularAsientoEnTx(tx, contextoDe(m), {
                asientoId: f,
                detalle: "Anulo la factura",
                clave: randomUUID(),
              }),
            (tx) =>
              imputarEnTx(tx, contextoDe(m), {
                saldanteId: p,
                repartos: [{ saldadoId: f, importe: imp("100.00") }],
                clave: randomUUID(),
              }),
          );
          // O gana la anulación (y la imputación falla: ASIENTO_ANULADO), o gana la imputación y la anulación, que deshace lo imputado antes
          // de anular, ve la imputación o falla con ASIENTO_CON_IMPUTACIONES; jamás las dos cosas confirmadas a la vez.
          const estado = await estadoDe(f);
          expect(estado?.anulado === true ? estado.imputado === "0.00" : true).toBe(true);
          if (anula.ok && imputa.ok) {
            // Solo es posible si la imputación confirmó primero y la anulación la deshizo.
            expect(estado).toMatchObject({ anulado: true, imputado: "0.00" });
          } else {
            expect(anula.ok || imputa.ok).toBe(true);
            const falla = anula.ok ? imputa : anula;
            expect(!falla.ok && ["ASIENTO_ANULADO", "ASIENTO_CON_IMPUTACIONES"]).toContain(
              !falla.ok && falla.error,
            );
          }
        });

        it("dos «deshacer» a la vez del mismo par: no se deshace más de lo imputado", async () => {
          const parte = await crearParte();
          const f1 = await registrar(cargo(parte, "100.00"));
          const f2 = await registrar(cargo(parte, "100.00"));
          const p = await registrar(pago(parte, "100.00"));
          exito(
            await imputar(p, [
              [f1, "60.00"],
              [f2, "40.00"],
            ]),
          );
          const deshacer = (tx: TxDeSaldos) =>
            deshacerImputacionEnTx(tx, contextoDe(m), {
              saldanteId: p,
              saldadoId: f1,
              importe: imp("60.00"),
              clave: randomUUID(),
            });
          const [a, b] = await ambos(deshacer, deshacer);
          expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
          const perdedor = a.ok ? b : a;
          expect(!perdedor.ok && perdedor.error).toBe("DESHACER_SUPERA_LO_IMPUTADO");
          expect(await estadoDe(p)).toMatchObject({ imputado: "40.00" });
          expect(await estadoDe(f1)).toMatchObject({ imputado: "0.00" });
        });

        it("el mismo asiento a la vez desde dos conexiones: uno solo", async () => {
          const parte = await crearParte();
          const e = cargo(parte, "12.00");
          const [a, b] = await ambos(
            (tx) => registrarAsientoEnTx(tx, contextoDe(m), e),
            (tx) => registrarAsientoEnTx(tx, contextoDe(m), e),
          );
          for (const r of [a, b])
            expect(r.ok || r.error === "CLAVE_YA_USADA" || r.error === "ORIGEN_YA_REGISTRADO").toBe(
              true,
            );
          expect(await cuantos("asiento_de_saldo", "parte_id = $1", [parte])).toBe(1);
          expect(await saldoDe(parte)).toBe("12.00");
        });
      });
    }
  });

  // ---------------------------------------------------------------------------------------------
  describe("aislamiento entre empresas", () => {
    it("lo de una empresa no se ve, no se imputa y no se anula desde otra; el saldo de una parte ajena es cero", async () => {
      const parteA = await crearParte(m);
      const a = await registrar(cargo(parteA, "10.00"));
      const verDesdeOtra = await leer(
        async (tx) => ({
          asiento: await tx.asientos.obtener(contextoDe(otra).empresaId, a),
          distribucion: await tx.asientos.distribucionDe(contextoDe(otra).empresaId, a),
          saldo: importeATexto(
            await tx.saldos.saldoDeParte(contextoDe(otra).empresaId, parteA, "A_PAGAR"),
          ),
          estado: await tx.saldos.estadoDeAsiento(contextoDe(otra).empresaId, a),
          pares: await tx.imputaciones.paresVigentesDe(contextoDe(otra).empresaId, a),
        }),
        otra,
      );
      expect(verDesdeOtra).toEqual({
        asiento: null,
        distribucion: [],
        saldo: "0.00",
        estado: null,
        pares: [],
      });
      // Con el contexto de OTRA empresa pero preguntando por el id de A: la base no lo muestra (RLS).
      const conOtroContexto = await correr(
        async (tx) => ({
          ok: true as const,
          valor: await tx.asientos.obtener(contextoDe(m).empresaId, a),
        }),
        { mundo: otra },
      );
      expect(exito(conOtroContexto)).toBeNull();
    });
  });
});
