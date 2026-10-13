import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  comprobanteId,
  crearRepositorioDeComprobantes,
  emisorId,
  errorFiscalDeRestriccion,
  origenId,
  puntoDeVentaId,
  traducirErroresDeFiscal,
  type FiscalDb,
} from "../../src/modulos/fiscal/publico";
import { importesParaArca } from "../../src/modulos/fiscal/dominio/importes-para-arca";
import type { Contexto } from "../../src/contexto/contexto";
import { importeATexto, importeDesdeTexto, sumar } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { consumidorFinal, receptorInscripto, renglon } from "../utilidades/facturacion";
import { crearEscenario, type Escenario } from "./facturacion-apoyo";
import { crearMundo } from "./fiscal-apoyo";
import {
  altaDe,
  altaDeNota,
  autorizar,
  cerrarLaSerie,
  comoPersonaDe,
  comoSistemaDe,
  crearEntornoFacturacion,
  diaDe,
  entrarEnValidacion,
  fechaCivil,
  huellaNueva,
  intentoDe,
  type TxFacturacionDePrueba,
} from "./facturacion-persistencia-apoyo";

/**
 * Facturación F3: el repositorio de comprobantes contra una base real, con los roles reales y su contexto
 * firmado, pasando por el adaptador de transacciones (el mismo camino que usarán los casos de uso). Qué prueba:
 *  1. Ida y vuelta: lo que se escribe es lo que se lee, con el dinero y las cantidades EXACTOS (nunca `number`).
 *  2. Idempotencia: repetir el alta devuelve el mismo comprobante sin duplicar renglones, desglose ni filas.
 *  3. Las transiciones del estado, con control de versión, y lo que la base frena.
 *  4. Aislamiento entre empresas (también del mismo tenant), y sin RLS el repositorio sigue filtrando.
 *  5. Atomicidad: una falla en cualquier paso deja la base como estaba (el comprobante, sus renglones, el
 *     desglose, la serie y la auditoría van juntos o no van).
 * La concurrencia está en `facturacion-persistencia-concurrencia.test.ts`; la traducción de cada restricción en
 * `facturacion-persistencia-traducciones.test.ts`; certificados, accesos e intentos en
 * `facturacion-persistencia-certificados.test.ts`; el ambiente en `facturacion-persistencia-ambiente.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-12T12:00:00.000Z");

/** Desarma un `Resultado` que tiene que ser un éxito. */
function exito<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)("facturación F3: el repositorio de comprobantes", () => {
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoFacturacion>;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    entorno = crearEntornoFacturacion(base);
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await consultar<{ n: string }>(texto, parametros))[0]?.n);
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, opciones);

  /** Corre el trabajo con ese contexto; un error de la base es un fallo del test. */
  async function correr<T>(
    contexto: Contexto,
    trabajo: (tx: TxFacturacionDePrueba) => Promise<T>,
  ): Promise<T> {
    const r = await entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  /** Igual, pero devuelve el `Resultado` para ver el error de la base tal como llega a un caso de uso. */
  const intentar = <T>(contexto: Contexto, trabajo: (tx: TxFacturacionDePrueba) => Promise<T>) =>
    entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));

  /** Cuántas filas de cada tabla de la facturación tiene la empresa. */
  const filasDe = async (e: Escenario) => ({
    comprobantes: await cuenta("select count(*) as n from comprobante where empresa_id = $1", [
      e.empresa,
    ]),
    renglones: await cuenta("select count(*) as n from comprobante_linea where empresa_id = $1", [
      e.empresa,
    ]),
    desglose: await cuenta("select count(*) as n from comprobante_alicuota where empresa_id = $1", [
      e.empresa,
    ]),
    auditoria: await cuenta(
      "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_CREADO'",
      [e.empresa],
    ),
  });

  // ===============================================================================================
  // 1. Ida y vuelta, con el dinero exacto
  // ===============================================================================================
  describe("lo que se escribe es lo que se lee", () => {
    it("una factura B con tres alícuotas, descuento y decimales largos vuelve igual, con los importes exactos", async () => {
      const e = await escenario();
      const alta = altaDe(e, {
        renglones: [
          renglon("9.95", "3", "21", "10"),
          renglon("0.333333", "0.3333", "10.5"),
          renglon("1500.5", "2", "EXENTO"),
        ],
      });
      const r = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta)));
      expect(r.creado).toBe(true);
      const g = r.valor;
      expect(g).toMatchObject({
        id: alta.id,
        empresaId: empresaId(e.empresa),
        emisorId: emisorId(e.emisor),
        puntoDeVentaId: puntoDeVentaId(e.pv),
        ambiente: "HOMOLOGACION",
        origen: alta.contenido.origen,
        clase: "FACTURA",
        tipo: "FACTURA_B",
        concepto: "PRODUCTOS",
        servicio: null,
        modoDePrecio: "IVA_INCLUIDO",
        asociado: null,
        motivo: null,
        estado: "PENDIENTE",
        envios: 0,
        numeroReservado: null,
        fechaEmision: null,
        numero: null,
        cae: null,
        caeVence: null,
        autorizadoEn: null,
        resueltoPor: null,
        motivoDeDescarte: null,
        huella: alta.huella,
        versionDeRepresentacion: 1,
        creadoPor: personaId(e.persona),
        version: 1,
      });
      const esperados = importesParaArca(alta.contenido);
      expect(g.importes).toEqual({
        total: esperados.total,
        neto: esperados.neto,
        iva: esperados.iva,
        exento: esperados.exento,
        noGravado: esperados.noGravado,
      });
      expect(g.renglones.map(({ posicion, ...resto }) => ({ posicion, ...resto }))).toEqual(
        alta.contenido.renglones.map((x, i) => ({ posicion: i + 1, ...x })),
      );
      expect(g.desglose).toEqual(alta.contenido.desglose);
      expect(g.receptor).toEqual(alta.contenido.receptor);
      expect(g.emisor).toMatchObject({
        cuit: e.cuit,
        razonSocial: e.razonSocial,
        condicionIva: "RESPONSABLE_INSCRIPTO",
        inicioDeActividades: "2020-01-01",
        iibbNumero: "901-123456-7",
        iibbCondicion: "LOCAL",
        puntoDeVentaNumero: e.pvNumero,
        datosFiscalesId: e.datosFiscales,
      });
      // Lo que la base guardó es `numeric` exacto: el texto de cada importe es el del dominio, sin redondeos.
      const [fila] = await consultar<Record<string, string>>(
        `select total::text, neto_gravado::text, iva::text, exento::text, no_gravado::text
           from comprobante where id = $1`,
        [alta.id],
      );
      expect(fila).toEqual({
        total: importeATexto(esperados.total),
        neto_gravado: importeATexto(esperados.neto),
        iva: importeATexto(esperados.iva),
        exento: importeATexto(esperados.exento),
        no_gravado: importeATexto(esperados.noGravado),
      });
      const lineas = await consultar<Record<string, string | null>>(
        `select cantidad::text, precio_unitario::text, descuento::text, importe::text
           from comprobante_linea where comprobante_id = $1 order by posicion`,
        [alta.id],
      );
      expect(lineas[0]).toMatchObject({
        cantidad: "3.0000",
        precio_unitario: "9.950000",
        descuento: "10.0000",
      });
      expect(lineas[1]).toMatchObject({
        cantidad: "0.3333",
        precio_unitario: "0.333333",
        descuento: null,
      });
    });

    it("un total en el tope de ImpTotal (13 enteros y 2 decimales) viaja exacto: ningún número de JavaScript lo representa", async () => {
      const e = await escenario();
      const alta = altaDe(e, { renglones: [renglon("999999999999.99", "10", "EXENTO")] });
      const g = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta))).valor;
      expect(importeATexto(g.importes.total)).toBe("9999999999999.90");
      expect(importeATexto(g.importes.exento)).toBe("9999999999999.90");
      expect(
        (
          await consultar<{ t: string }>("select total::text as t from comprobante where id = $1", [
            alta.id,
          ])
        )[0],
      ).toEqual({ t: "9999999999999.90" });
      // Ni el número más cercano que representa un `number` (9999999999999.9) es el que quedó guardado.
      expect(String(Number("9999999999999.90"))).toBe("9999999999999.9");
    });

    it("la letra C (monotributo) guarda renglones sin alícuota y ningún desglose; el neto es el total", async () => {
      const e = await escenario({ condicionIva: "MONOTRIBUTO" });
      const alta = altaDe(e, { renglones: [renglon("50.00", "2", null)] });
      expect(alta.contenido.tipo).toBe("FACTURA_C");
      const g = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta))).valor;
      expect(g.tipo).toBe("FACTURA_C");
      expect(g.renglones.map((x) => x.alicuota)).toEqual([null]);
      expect(g.desglose).toEqual([]);
      expect(importeATexto(g.importes.neto)).toBe("100.00");
      expect(importeATexto(g.importes.iva)).toBe("0.00");
      expect(await filasDe(e)).toMatchObject({ comprobantes: 1, renglones: 1, desglose: 0 });
    });

    it("una factura A a un responsable inscripto con IVA discriminado y servicios: receptor, período y fechas exactos", async () => {
      const e = await escenario();
      const alta = altaDe(e, {
        receptor: receptorInscripto,
        entrada: {
          modoDePrecio: "IVA_DISCRIMINADO",
          concepto: "PRODUCTOS_Y_SERVICIOS",
          servicio: {
            desde: fechaCivil("2026-02-01"),
            hasta: fechaCivil("2026-02-28"),
            vencimientoDePago: fechaCivil("2026-03-10"),
          },
        },
        renglones: [renglon("100.00", "3", "21"), renglon("40.00", "1", "10.5")],
      });
      expect(alta.contenido.tipo).toBe("FACTURA_A");
      const g = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta))).valor;
      expect(g.tipo).toBe("FACTURA_A");
      expect(g.modoDePrecio).toBe("IVA_DISCRIMINADO");
      expect(g.concepto).toBe("PRODUCTOS_Y_SERVICIOS");
      expect(g.servicio).toEqual(alta.contenido.servicio);
      expect(g.receptor).toEqual(receptorInscripto);
      expect(g.desglose.map((d) => d.alicuota)).toEqual(["10.5", "21"]);
      // Las fechas civiles no se corren un día por el huso: son texto en la frontera y `date` en la base.
      expect(
        (
          await consultar<Record<string, string>>(
            `select servicio_desde::text, servicio_hasta::text, vencimiento_pago::text from comprobante where id = $1`,
            [alta.id],
          )
        )[0],
      ).toEqual({
        servicio_desde: "2026-02-01",
        servicio_hasta: "2026-02-28",
        vencimiento_pago: "2026-03-10",
      });
    });

    it("una nota de crédito y una de débito sobre un comprobante autorizado guardan su asociado y se leen con lo que viaja en CbtesAsoc", async () => {
      const e = await escenario();
      const factura = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(factura));
      const autorizada = await correr(comoSistemaDe(e), (tx) =>
        autorizar(tx, factura.id, e.empresa, AHORA, 41n),
      );
      expect(autorizada).toMatchObject({ estado: "AUTORIZADO", numero: 42n, numeroReservado: 42n });
      const nc = altaDeNota(e, autorizada, { clase: "NOTA_CREDITO", motivo: "Devolución parcial" });
      const nd = altaDeNota(e, autorizada, { clase: "NOTA_DEBITO", motivo: null });
      const [g1, g2] = await correr(comoPersonaDe(e), async (tx) => [
        exito(await tx.comprobantes.crear(nc)).valor,
        exito(await tx.comprobantes.crear(nd)).valor,
      ]);
      const asociado = {
        id: factura.id,
        tipo: "FACTURA_B",
        puntoDeVenta: e.pvNumero,
        numero: 42n,
        cuit: e.cuit,
        fecha: diaDe(AHORA),
      };
      expect(g1).toMatchObject({
        clase: "NOTA_CREDITO",
        tipo: "NOTA_CREDITO_B",
        motivo: "Devolución parcial",
        asociado,
      });
      expect(g2).toMatchObject({
        clase: "NOTA_DEBITO",
        tipo: "NOTA_DEBITO_B",
        motivo: null,
        asociado,
      });
      expect(g1.receptor).toEqual(autorizada.receptor);
      // El asociado no se puede discutir: una nota que apunta a algo que no está autorizado la frena la base.
      const pendiente = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(pendiente));
      const sobreUnPendiente = await intentar(comoPersonaDe(e), (tx) =>
        tx.comprobantes.crear({ ...altaDeNota(e, autorizada), asociadoId: pendiente.id }),
      );
      expect(sobreUnPendiente).toEqual(
        err({ tipo: "Check", restriccion: "comprobante_asociado_invalido" }),
      );
      expect(traducirErroresDeFiscal(sobreUnPendiente, ["COMPROBANTE_ASOCIADO_INVALIDO"])).toEqual(
        err("COMPROBANTE_ASOCIADO_INVALIDO"),
      );
    });

    it("una nota lleva su asociado y una factura no: lo contrario es un defecto de quien llama, no un caso de negocio", async () => {
      const e = await escenario();
      const factura = altaDe(e);
      await expect(
        correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.crear({ ...factura, asociadoId: comprobanteId(randomUUID()) }),
        ),
      ).rejects.toThrow(/asociado/);
    });
  });

  // ===============================================================================================
  // 2. Idempotencia
  // ===============================================================================================
  describe("idempotencia: repetir el alta no duplica nada", () => {
    it("el mismo comprobante dos veces devuelve el mismo (creado: false) sin un renglón, un desglose ni una fila más", async () => {
      const e = await escenario();
      const alta = altaDe(e, {
        renglones: [renglon("10.00", "1", "21"), renglon("5.00", "2", "10.5")],
      });
      const primero = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta)));
      const antes = await filasDe(e);
      const segundo = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta)));
      expect(primero.creado).toBe(true);
      expect(segundo).toEqual({ creado: false, valor: primero.valor });
      expect(await filasDe(e)).toEqual(antes);
      expect(antes).toMatchObject({ comprobantes: 1, renglones: 2, desglose: 2 });
    });

    it("la misma clave manual con OTRO id (el reintento de la pantalla) devuelve el comprobante original; la huella la compara el caso de uso", async () => {
      const e = await escenario();
      const original = altaDe(e);
      const clave = original.contenido.origen;
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(original));
      // Mismo pedido con otro id: la repetición.
      const repetida = exito(
        await correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.crear({ ...altaDe(e, { origen: clave, huella: original.huella }) }),
        ),
      );
      expect(repetida.creado).toBe(false);
      expect(repetida.valor.id).toBe(original.id);
      expect(repetida.valor.huella).toBe(original.huella);
      // Mismo origen con OTROS datos: devuelve igual el original, con SU huella (el caso de uso dice CLAVE_REUTILIZADA).
      const otrosDatos = exito(
        await correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.crear(
            altaDe(e, { origen: clave, renglones: [renglon("99.00", "1", "21")] }),
          ),
        ),
      );
      expect(otrosDatos.creado).toBe(false);
      expect(otrosDatos.valor.id).toBe(original.id);
      expect(otrosDatos.valor.huella).toBe(original.huella);
      expect(await filasDe(e)).toMatchObject({ comprobantes: 1, renglones: 1, desglose: 1 });
    });

    it("una clave manual no da dos comprobantes ni después de un rechazo", async () => {
      const e = await escenario();
      const original = altaDe(e);
      const clave = original.contenido.origen;
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(original));
      await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, original.id, e.empresa, AHORA);
        await cerrarLaSerie(tx, c, "RECHAZADO");
        const rechazado = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
          a: "RECHAZADO",
        });
        expect(rechazado?.estado).toBe("RECHAZADO");
      });
      // Corregir es OTRA clave: la misma devuelve el rechazado (un reintento tardío de red no crea un segundo intento).
      const repetida = exito(
        await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaDe(e, { origen: clave }))),
      );
      expect(repetida).toMatchObject({
        creado: false,
        valor: { id: original.id, estado: "RECHAZADO" },
      });
      expect(await filasDe(e)).toMatchObject({ comprobantes: 1 });
    });

    it("la clave manual es de la empresa: también frena a una nota con la misma clave que una factura (otra clase)", async () => {
      const e = await escenario();
      const factura = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(factura));
      const autorizada = await correr(comoSistemaDe(e), (tx) =>
        autorizar(tx, factura.id, e.empresa, AHORA),
      );
      const nota = altaDeNota(e, autorizada, { origen: factura.contenido.origen });
      const r = exito(await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(nota)));
      // No entra otra: devuelve la factura de esa clave, con su huella (distinta de la de la nota).
      expect(r).toMatchObject({ creado: false, valor: { id: factura.id, clase: "FACTURA" } });
      expect(r.valor.huella).not.toBe(nota.huella);
      expect(await filasDe(e)).toMatchObject({ comprobantes: 1 });
    });

    it("lo que no es manual: el vigente se repite, pero un rechazado o un descartado liberan el origen y entra uno nuevo", async () => {
      const e = await escenario();
      const origen = { tipo: "SUSCRIPCION", id: origenId(`suscripcion-${randomUUID()}`) } as const;
      const primero = altaDe(e, { origen });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(primero));
      const repetida = exito(
        await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaDe(e, { origen }))),
      );
      expect(repetida).toMatchObject({ creado: false, valor: { id: primero.id } });
      // Se descarta (PENDIENTE → DESCARTADO): el origen queda libre.
      const descartado = await correr(comoPersonaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), primero.id);
        return tx.comprobantes.transicionar(empresaId(e.empresa), primero.id, c?.version ?? 0, {
          a: "DESCARTADO",
          motivo: "Cargado por error",
        });
      });
      expect(descartado).toMatchObject({
        estado: "DESCARTADO",
        motivoDeDescarte: "Cargado por error",
      });
      const nuevo = exito(
        await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaDe(e, { origen }))),
      );
      expect(nuevo.creado).toBe(true);
      expect(nuevo.valor.id).not.toBe(primero.id);
      // Y ahora SÍ hay dos del mismo origen, uno vigente y uno descartado: `delOrigen` los trae a los dos.
      const delOrigen = await correr(comoPersonaDe(e), (tx) =>
        tx.comprobantes.delOrigen(empresaId(e.empresa), "SUSCRIPCION", origen.id),
      );
      expect(delOrigen.map((c) => c.estado).sort()).toEqual(["DESCARTADO", "PENDIENTE"]);
    });

    it("el mismo origen de otro tipo, de otro emisor o de otra clase es otro origen: entra", async () => {
      const e = await escenario();
      const id = origenId(`origen-${randomUUID()}`);
      const a = altaDe(e, { origen: { tipo: "SUSCRIPCION", id } });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(a));
      // Otro tipo de origen con el mismo id de origen.
      const otroTipo = exito(
        await correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.crear(altaDe(e, { origen: { tipo: "CORRECCION_DE_TICKET", id } })),
        ),
      );
      expect(otroTipo.creado).toBe(true);
      // Otra clase (nota de crédito sobre una factura autorizada) del mismo origen y emisor.
      const factura = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(factura));
      const autorizada = await correr(comoSistemaDe(e), (tx) =>
        autorizar(tx, factura.id, e.empresa, AHORA),
      );
      const nota = exito(
        await correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.crear(altaDeNota(e, autorizada, { origen: { tipo: "SUSCRIPCION", id } })),
        ),
      );
      expect(nota.creado).toBe(true);
    });

    it("el id de un comprobante de OTRA identidad, o de otra empresa, es ID_EN_USO y no revela nada", async () => {
      const a = await escenario();
      const b = await escenario();
      const deA = altaDe(a);
      await correr(comoPersonaDe(a), (tx) => tx.comprobantes.crear(deA));
      // Mismo id con otro origen, en la misma empresa.
      const otraIdentidad = await correr(comoPersonaDe(a), (tx) =>
        tx.comprobantes.crear({ ...altaDe(a), id: deA.id }),
      );
      expect(otraIdentidad).toEqual(err("ID_EN_USO"));
      // Ese mismo id, pedido por otra empresa: su RLS no ve la fila de A, y aun así no se pisa nada.
      const ajeno = await correr(comoPersonaDe(b), (tx) =>
        tx.comprobantes.crear({ ...altaDe(b), id: deA.id }),
      );
      expect(ajeno).toEqual(err("ID_EN_USO"));
      expect(await filasDe(b)).toMatchObject({ comprobantes: 0, renglones: 0 });
      expect(await filasDe(a)).toMatchObject({ comprobantes: 1 });
    });

    it("`delOrigen` trae todos los estados, el más nuevo primero, y solo los de ese origen", async () => {
      const e = await escenario();
      const origen = { tipo: "SUSCRIPCION", id: origenId(`o-${randomUUID()}`) } as const;
      const uno = altaDe(e, { origen });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(uno));
      await correr(comoPersonaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), uno.id);
        await tx.comprobantes.transicionar(empresaId(e.empresa), uno.id, c?.version ?? 0, {
          a: "DESCARTADO",
          motivo: "x",
        });
      });
      const dos = altaDe(e, { origen });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(dos));
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaDe(e)));
      const r = await correr(comoPersonaDe(e), (tx) =>
        tx.comprobantes.delOrigen(empresaId(e.empresa), "SUSCRIPCION", origen.id),
      );
      expect(r.map((c) => c.id)).toEqual([dos.id, uno.id]);
      expect(
        await correr(comoPersonaDe(e), (tx) =>
          tx.comprobantes.delOrigen(empresaId(e.empresa), "SUSCRIPCION", origenId("nada")),
        ),
      ).toEqual([]);
    });
  });

  // ===============================================================================================
  // 3. Transiciones
  // ===============================================================================================
  describe("transiciones del estado", () => {
    const nuevoPendiente = async (e: Escenario) => {
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta));
      return alta.id;
    };

    it("el camino feliz: PENDIENTE → EN_VALIDACION → AUTORIZADO, con la serie en la misma transacción", async () => {
      const e = await escenario();
      const id = await nuevoPendiente(e);
      const enValidacion = await correr(comoSistemaDe(e), (tx) =>
        entrarEnValidacion(tx, id, e.empresa, AHORA, 9n),
      );
      expect(enValidacion).toMatchObject({
        estado: "EN_VALIDACION",
        envios: 1,
        numeroReservado: 10n,
        fechaEmision: diaDe(AHORA),
        numero: null,
        cae: null,
        version: 2,
      });
      const serie = await consultar<Record<string, string>>(
        "select estado, ultimo_numero::text, numero_en_curso::text, solicitud_en_curso::text from serie_comprobante where punto_de_venta_id = $1",
        [e.pv],
      );
      expect(serie[0]).toEqual({
        estado: "EN_CURSO",
        ultimo_numero: "9",
        numero_en_curso: "10",
        solicitud_en_curso: id,
      });
      const autorizado = await correr(comoSistemaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), id);
        if (c === null) throw new Error("no está");
        await cerrarLaSerie(tx, c, "AUTORIZADO");
        return tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
          a: "AUTORIZADO",
          cae: "74123456789012",
          caeVence: fechaCivil("2026-10-22"),
          autorizadoEn: AHORA,
          resueltoPor: "RESPUESTA",
        });
      });
      expect(autorizado).toMatchObject({
        estado: "AUTORIZADO",
        // El número autorizado es el reservado: lo copia la base, no quien llama.
        numero: 10n,
        numeroReservado: 10n,
        cae: "74123456789012",
        caeVence: "2026-10-22",
        autorizadoEn: AHORA,
        resueltoPor: "RESPUESTA",
        envios: 1,
        version: 3,
      });
      expect(
        (
          await consultar<Record<string, string>>(
            "select estado, ultimo_numero::text from serie_comprobante where punto_de_venta_id = $1",
            [e.pv],
          )
        )[0],
      ).toEqual({ estado: "LIBRE", ultimo_numero: "10" });
    });

    it("con una versión vieja, o de otra empresa, no toca nada y devuelve null", async () => {
      const e = await escenario();
      const otra = await escenario();
      const id = await nuevoPendiente(e);
      const viejo = await correr(comoPersonaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), id, 7, {
          a: "DESCARTADO",
          motivo: "no",
        }),
      );
      expect(viejo).toBeNull();
      const ajeno = await correr(comoPersonaDe(otra), (tx) =>
        tx.comprobantes.transicionar(empresaId(otra.empresa), id, 1, {
          a: "DESCARTADO",
          motivo: "no",
        }),
      );
      expect(ajeno).toBeNull();
      expect(
        (
          await consultar<{ estado: string; version: number }>(
            "select estado, version from comprobante where id = $1",
            [id],
          )
        )[0],
      ).toEqual({ estado: "PENDIENTE", version: 1 });
    });

    it("una transición que la tabla no permite sale como error de la base con su nombre (y no cambia nada)", async () => {
      const e = await escenario();
      const id = await nuevoPendiente(e);
      // PENDIENTE → AUTORIZADO no existe: hay que pasar por EN_VALIDACION.
      const r = await intentar(comoSistemaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), id, 1, { a: "RECHAZADO" }),
      );
      expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_transicion_invalida" }));
      expect(traducirErroresDeFiscal(r, ["COMPROBANTE_TRANSICION_INVALIDA"])).toEqual(
        err("COMPROBANTE_TRANSICION_INVALIDA"),
      );
      expect(
        (
          await consultar<{ estado: string }>("select estado from comprobante where id = $1", [id])
        )[0],
      ).toEqual({ estado: "PENDIENTE" });
    });

    it("un rechazado no vuelve a PENDIENTE (es terminal) y un INCIERTO solo se autoriza por reconciliación", async () => {
      const e = await escenario();
      const id = await nuevoPendiente(e);
      const rechazado = await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, id, e.empresa, AHORA);
        await cerrarLaSerie(tx, c, "RECHAZADO");
        return tx.comprobantes.transicionar(c.empresaId, c.id, c.version, { a: "RECHAZADO" });
      });
      expect(rechazado?.estado).toBe("RECHAZADO");
      expect(rechazado).toMatchObject({ numeroReservado: 1n });
      const vuelve = await intentar(comoSistemaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), id, rechazado?.version ?? 0, {
          a: "PENDIENTE",
        }),
      );
      expect(vuelve).toEqual(
        err({ tipo: "Check", restriccion: "comprobante_transicion_invalida" }),
      );

      const otro = await nuevoPendiente(e);
      const incierto = await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, otro, e.empresa, AHORA, 1n);
        return tx.comprobantes.transicionar(c.empresaId, c.id, c.version, { a: "INCIERTO" });
      });
      expect(incierto?.estado).toBe("INCIERTO");
      const porRespuesta = await intentar(comoSistemaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), otro);
        return tx.comprobantes.transicionar(c!.empresaId, c!.id, c!.version, {
          a: "AUTORIZADO",
          cae: "74123456789012",
          caeVence: fechaCivil("2026-10-22"),
          autorizadoEn: AHORA,
          resueltoPor: "RESPUESTA",
        });
      });
      expect(porRespuesta).toEqual(
        err({ tipo: "Check", restriccion: "comprobante_transicion_invalida" }),
      );
      // Por reconciliación sí (y la serie, que sigue EN_CURSO, se cierra en la misma transacción).
      const reconciliado = await correr(comoSistemaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), otro);
        await cerrarLaSerie(tx, c!, "AUTORIZADO");
        return tx.comprobantes.transicionar(c!.empresaId, c!.id, c!.version, {
          a: "AUTORIZADO",
          cae: "74123456789013",
          caeVence: fechaCivil("2026-10-22"),
          autorizadoEn: AHORA,
          resueltoPor: "RECONCILIACION",
        });
      });
      // El rechazado no consumió el número: este comprobante recibió el 1.
      expect(reconciliado).toMatchObject({
        estado: "AUTORIZADO",
        numero: 1n,
        resueltoPor: "RECONCILIACION",
        envios: 1,
      });
    });

    it("volver a PENDIENTE vacía el número y la fecha reservados, y el reintento cuenta un envío más", async () => {
      const e = await escenario();
      const id = await nuevoPendiente(e);
      const liberado = await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, id, e.empresa, AHORA);
        // El pedido seguro no salió: la serie se libera sin avanzar y el comprobante vuelve a PENDIENTE.
        await cerrarLaSerie(tx, c, "RECHAZADO");
        return tx.comprobantes.transicionar(c.empresaId, c.id, c.version, { a: "PENDIENTE" });
      });
      expect(liberado).toMatchObject({
        estado: "PENDIENTE",
        numeroReservado: null,
        fechaEmision: null,
        envios: 1,
      });
      const otraVez = await correr(comoSistemaDe(e), (tx) =>
        entrarEnValidacion(tx, id, e.empresa, AHORA),
      );
      // La serie no avanzó: el mismo número, y un envío más.
      expect(otraVez).toMatchObject({ estado: "EN_VALIDACION", numeroReservado: 1n, envios: 2 });
    });

    it("descartar pide un motivo; CONFLICTO sale a PENDIENTE o a DESCARTADO", async () => {
      const e = await escenario();
      const id = await nuevoPendiente(e);
      const sinMotivo = await intentar(comoPersonaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), id, 1, { a: "DESCARTADO", motivo: " " }),
      );
      expect(sinMotivo).toEqual(err({ tipo: "Check", restriccion: "comprobante_descarte_ck" }));
      expect(traducirErroresDeFiscal(sinMotivo, ["MOTIVO_DE_DESCARTE_INVALIDO"])).toEqual(
        err("MOTIVO_DE_DESCARTE_INVALIDO"),
      );

      const conflicto = await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, id, e.empresa, AHORA);
        // Otro sistema usó el número: la serie queda bloqueada y el comprobante en conflicto.
        const serie = await tx.series.obtener(c.empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
        if (serie?.estado !== "EN_CURSO") throw new Error("tenía que estar en curso");
        await tx.series.guardar({
          empresaId: serie.empresaId,
          puntoDeVentaId: serie.puntoDeVentaId,
          emisorId: serie.emisorId,
          tipo: serie.tipo,
          version: serie.version,
          ambiente: c.ambiente,
          estado: "BLOQUEADA",
          ultimoNumero: serie.ultimoNumero,
          motivoBloqueo: "ARCA tiene otro comprobante con este número",
        });
        return tx.comprobantes.transicionar(c.empresaId, c.id, c.version, { a: "CONFLICTO" });
      });
      expect(conflicto).toMatchObject({ estado: "CONFLICTO", numeroReservado: 1n });
      const descartado = await correr(comoPersonaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), id, conflicto?.version ?? 0, {
          a: "DESCARTADO",
          motivo: "Otro sistema usó el número",
        }),
      );
      // Un descartado desde CONFLICTO conserva el número disputado (para diagnosticar).
      expect(descartado).toMatchObject({
        estado: "DESCARTADO",
        motivoDeDescarte: "Otro sistema usó el número",
        numeroReservado: 1n,
      });
    });

    it("`enVueloVencidos` trae los EN_VALIDACION e INCIERTO con la reserva vencida, la más vieja primero, de cualquier ambiente, con límite", async () => {
      const e = await escenario();
      const mucho = new Date("2026-10-12T10:00:00.000Z"); // la reserva vence a las 10:05
      const poco = new Date("2026-10-12T11:00:00.000Z"); // vence a las 11:05
      const ahora = new Date("2026-10-12T11:30:00.000Z");
      const vencido1 = await nuevoPendiente(e);
      await correr(comoSistemaDe(e), (tx) => entrarEnValidacion(tx, vencido1, e.empresa, mucho));
      // Otra serie (otro tipo: letra A a un inscripto) reservada más tarde: también vencida, pero después.
      const altaA = altaDe(e, { receptor: receptorInscripto });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaA));
      await correr(comoSistemaDe(e), async (tx) => {
        const c = await entrarEnValidacion(tx, altaA.id, e.empresa, poco);
        await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, { a: "INCIERTO" });
      });
      // Una tercera, todavía vigente (reservó hace un rato): no vence.
      const altaC = altaDe(e, {
        receptor: consumidorFinal,
        origen: { tipo: "SUSCRIPCION", id: origenId(`v-${randomUUID()}`) },
      });
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(altaC));
      // Mismo tipo que la primera (FACTURA_B) y la serie está ocupada: no puede reservar; queda PENDIENTE.
      const todos = await correr(comoSistemaDe(e), (tx) =>
        tx.comprobantes.enVueloVencidos(empresaId(e.empresa), ahora, 10),
      );
      expect(todos.map((c) => [c.id, c.estado])).toEqual([
        [vencido1, "EN_VALIDACION"],
        [altaA.id, "INCIERTO"],
      ]);
      expect(
        (
          await correr(comoSistemaDe(e), (tx) =>
            tx.comprobantes.enVueloVencidos(empresaId(e.empresa), ahora, 1),
          )
        ).map((c) => c.id),
      ).toEqual([vencido1]);
      // Antes de que venza la primera, no hay nada.
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.comprobantes.enVueloVencidos(
            empresaId(e.empresa),
            new Date("2026-10-12T10:04:59.999Z"),
            10,
          ),
        ),
      ).toEqual([]);
      // En el instante exacto en que vence, sí (`en_curso_hasta <= ahora`).
      expect(
        (
          await correr(comoSistemaDe(e), (tx) =>
            tx.comprobantes.enVueloVencidos(
              empresaId(e.empresa),
              new Date("2026-10-12T10:05:00.000Z"),
              10,
            ),
          )
        ).map((c) => c.id),
      ).toEqual([vencido1]);
    });
  });

  // ===============================================================================================
  // 4. Aislamiento
  // ===============================================================================================
  describe("aislamiento entre empresas", () => {
    it("otra empresa (también del mismo tenant) no ve, no cambia ni crea a nombre ajeno; el trabajo de sistema de A sí ve lo de A", async () => {
      const a = await escenario();
      const b = await escenario({ mundo: await crearMundo(dueno, { tenant: a.tenant }) });
      const alta = altaDe(a);
      const creado = exito(
        await correr(comoPersonaDe(a), (tx) => tx.comprobantes.crear(alta)),
      ).valor;
      const desdeB = await correr(comoPersonaDe(b), async (tx) => ({
        obtener: await tx.comprobantes.obtener(empresaId(a.empresa), alta.id),
        delOrigen: await tx.comprobantes.delOrigen(
          empresaId(a.empresa),
          alta.contenido.origen.tipo,
          alta.contenido.origen.id,
        ),
        transicionar: await tx.comprobantes.transicionar(
          empresaId(a.empresa),
          alta.id,
          creado.version,
          { a: "DESCARTADO", motivo: "ajeno" },
        ),
        vencidos: await tx.comprobantes.enVueloVencidos(
          empresaId(a.empresa),
          new Date("2030-01-01T00:00:00Z"),
          10,
        ),
      }));
      expect(desdeB).toEqual({ obtener: null, delOrigen: [], transicionar: null, vencidos: [] });
      // Crear a nombre de A siendo B: el contexto de B no puede insertar filas de A (RLS).
      const aNombreDeA = await intentar(comoPersonaDe(b), (tx) => tx.comprobantes.crear(alta));
      expect(aNombreDeA.ok).toBe(false);
      expect(
        await correr(comoSistemaDe(a), (tx) =>
          tx.comprobantes.obtener(empresaId(a.empresa), alta.id),
        ),
      ).toEqual(creado);
      expect(await filasDe(a)).toMatchObject({ comprobantes: 1 });
      expect(await filasDe(b)).toMatchObject({ comprobantes: 0 });
    });

    it("un comprobante no apunta al punto de venta, al emisor ni a los datos fiscales de otra empresa: la clave foránea compuesta lo frena", async () => {
      const a = await escenario();
      const b = await escenario();
      const conPvAjeno = {
        ...altaDe(a),
        contenido: { ...altaDe(a).contenido, puntoDeVentaId: puntoDeVentaId(b.pv) },
      };
      const r = await intentar(comoPersonaDe(a), (tx) => tx.comprobantes.crear(conPvAjeno));
      expect(r).toEqual(err({ tipo: "Referencia", restriccion: "comprobante_pv_fkey" }));
      expect(traducirErroresDeFiscal(r, ["PUNTO_DE_VENTA_NO_ENCONTRADO"])).toEqual(
        err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
      );
      const conDatosAjenos = {
        ...altaDe(a),
        datosFiscales: { ...altaDe(a).datosFiscales, id: altaDe(b).datosFiscales.id },
      };
      const r2 = await intentar(comoPersonaDe(a), (tx) => tx.comprobantes.crear(conDatosAjenos));
      expect(r2).toEqual(
        err({ tipo: "Referencia", restriccion: "comprobante_datos_fiscales_fkey" }),
      );
      expect(traducirErroresDeFiscal(r2, ["DATOS_FISCALES_NO_ENCONTRADOS"])).toEqual(
        err("DATOS_FISCALES_NO_ENCONTRADOS"),
      );
    });

    describe("sin RLS (el dueño de la base la evade), el repositorio sigue filtrando por empresa", () => {
      let pool: pg.Pool;
      let sinRls: Kysely<FiscalDb>;
      beforeAll(() => {
        if (base === null) return;
        pool = new pg.Pool({ connectionString: base.dueno, max: 2 });
        sinRls = new Kysely<FiscalDb>({ dialect: new PostgresDialect({ pool }) });
      });
      afterAll(async () => {
        await sinRls.destroy();
      });

      it("lo que es de otra empresa no se lee ni se toca aunque se tenga el id, con el filtro como única defensa", async () => {
        const a = await escenario();
        const b = await escenario();
        const alta = altaDe(a);
        const creado = exito(
          await correr(comoPersonaDe(a), (tx) => tx.comprobantes.crear(alta)),
        ).valor;
        const repo = crearRepositorioDeComprobantes(sinRls);
        const eB = empresaId(b.empresa);
        expect(await repo.obtener(empresaId(a.empresa), alta.id)).toEqual(creado); // control: sin filtro de B, A sí está ahí
        expect(await repo.obtener(eB, alta.id)).toBeNull();
        expect(
          await repo.delOrigen(eB, alta.contenido.origen.tipo, alta.contenido.origen.id),
        ).toEqual([]);
        expect(
          await repo.transicionar(eB, alta.id, creado.version, {
            a: "DESCARTADO",
            motivo: "ajeno",
          }),
        ).toBeNull();
        expect(await repo.enVueloVencidos(eB, new Date("2030-01-01T00:00:00Z"), 10)).toEqual([]);
        expect(
          (
            await consultar<{ estado: string }>("select estado from comprobante where id = $1", [
              alta.id,
            ])
          )[0],
        ).toEqual({ estado: "PENDIENTE" });
      });
    });
  });

  // ===============================================================================================
  // 5. Atomicidad: nada a medias
  // ===============================================================================================
  describe("atomicidad: una falla en cualquier paso deja la base como estaba", () => {
    const vacia = { comprobantes: 0, renglones: 0, desglose: 0, auditoria: 0 };

    it("un renglón que la base rechaza (con el comprobante ya insertado) deshace el comprobante", async () => {
      const e = await escenario();
      const alta = altaDe(e);
      const roto = {
        ...alta,
        contenido: {
          ...alta.contenido,
          renglones: alta.contenido.renglones.map((r) => ({ ...r, descripcion: "x".repeat(201) })),
        },
      };
      const r = await intentar(comoPersonaDe(e), (tx) => tx.comprobantes.crear(roto));
      expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_linea_descripcion_ck" }));
      expect(await filasDe(e)).toEqual(vacia);
    });

    it("un desglose que la base rechaza (con el comprobante y los renglones ya insertados) deshace todo", async () => {
      const e = await escenario();
      const alta = altaDe(e);
      // Dos filas de la misma alícuota que suman lo mismo: el comprobante y los renglones entran y el desglose choca
      // con su clave (una alícuota por comprobante).
      const [unico] = alta.contenido.desglose;
      if (unico === undefined) throw new Error("tenía que haber desglose");
      const mitad = {
        alicuota: unico.alicuota,
        total: importeDesdeTexto(ARS, "60.50"),
        neto: importeDesdeTexto(ARS, "50.00"),
        iva: importeDesdeTexto(ARS, "10.50"),
      };
      const roto = { ...alta, contenido: { ...alta.contenido, desglose: [mitad, mitad] } };
      const r = await intentar(comoPersonaDe(e), (tx) => tx.comprobantes.crear(roto));
      expect(r).toEqual(err({ tipo: "Unicidad", restriccion: "comprobante_alicuota_pkey" }));
      expect(await filasDe(e)).toEqual(vacia);
    });

    it("renglones que no suman el total se descubren al CONFIRMAR (restricción diferida) y deshacen todo", async () => {
      const e = await escenario();
      const alta = altaDe(e, {
        renglones: [renglon("10.00", "1", "21"), renglon("5.00", "1", "10.5")],
      });
      // Cada fila es válida por sí sola, pero los renglones suman un centavo más que el total.
      const [primero, ...resto] = alta.contenido.renglones;
      if (primero === undefined) throw new Error("tenía que haber renglones");
      const roto = {
        ...alta,
        contenido: {
          ...alta.contenido,
          renglones: [
            { ...primero, importe: sumar(primero.importe, importeDesdeTexto(ARS, "0.01")) },
            ...resto,
          ],
        },
      };
      const r = await intentar(comoPersonaDe(e), (tx) => tx.comprobantes.crear(roto));
      expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_descuadrado" }));
      expect(traducirErroresDeFiscal(r, ["COMPROBANTE_DESCUADRADO"])).toEqual(
        err("COMPROBANTE_DESCUADRADO"),
      );
      expect(await filasDe(e)).toEqual(vacia);
    });

    it("la auditoría va en la misma transacción: si falla después de crear, no queda ni el comprobante ni el registro", async () => {
      const e = await escenario();
      for (const falla of ["negocio", "excepción"] as const) {
        const alta = altaDe(e);
        const trabajo = async (tx: TxFacturacionDePrueba) => {
          exito(await tx.comprobantes.crear(alta));
          await tx.auditoria.registrar({
            empresaId: empresaId(e.empresa),
            actorPersonaId: personaId(e.persona),
            accion: "COMPROBANTE_CREADO",
            entidad: "comprobante",
            entidadId: alta.id,
            despues: { tipo: alta.contenido.tipo },
          });
          // Hasta acá, todo escrito; ahora falla lo que sigue (por ejemplo, encolar el trabajo).
          if (falla === "excepción") throw new Error("falla forzada después de auditar");
          return err("FALLA_FORZADA" as const);
        };
        if (falla === "negocio") {
          const r = await entorno.ejecutar({ contexto: comoPersonaDe(e) }, trabajo);
          expect(r).toEqual(err("FALLA_FORZADA"));
        } else {
          await expect(entorno.ejecutar({ contexto: comoPersonaDe(e) }, trabajo)).rejects.toThrow(
            /falla forzada/,
          );
        }
        expect(await filasDe(e), falla).toEqual(vacia);
      }
      // Y sin falla, las dos cosas quedan juntas.
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), async (tx) => {
        exito(await tx.comprobantes.crear(alta));
        await tx.auditoria.registrar({
          empresaId: empresaId(e.empresa),
          actorPersonaId: personaId(e.persona),
          accion: "COMPROBANTE_CREADO",
          entidad: "comprobante",
          entidadId: alta.id,
          despues: { tipo: alta.contenido.tipo },
        });
      });
      expect(await filasDe(e)).toMatchObject({
        comprobantes: 1,
        renglones: 1,
        desglose: 1,
        auditoria: 1,
      });
    });

    it("reservar el número y pasar a EN_VALIDACION van juntos: si falla lo que sigue, la serie vuelve a LIBRE y el comprobante a PENDIENTE", async () => {
      const e = await escenario();
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta));
      const r = await entorno.ejecutar({ contexto: comoSistemaDe(e) }, async (tx) => {
        await entrarEnValidacion(tx, alta.id, e.empresa, AHORA);
        return err("FALLA_FORZADA" as const);
      });
      expect(r).toEqual(err("FALLA_FORZADA"));
      expect(
        (
          await consultar<{ estado: string }>("select estado from comprobante where id = $1", [
            alta.id,
          ])
        )[0],
      ).toEqual({ estado: "PENDIENTE" });
      // Ni siquiera se creó la serie (se creó en la misma transacción).
      expect(
        await cuenta("select count(*) as n from serie_comprobante where punto_de_venta_id = $1", [
          e.pv,
        ]),
      ).toBe(0);
    });

    it("pasar a EN_VALIDACION SIN reservar el número en la serie lo descubre la base al confirmar y no deja nada a medias", async () => {
      const e = await escenario();
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta));
      const r = await intentar(comoSistemaDe(e), (tx) =>
        tx.comprobantes.transicionar(empresaId(e.empresa), alta.id, 1, {
          a: "EN_VALIDACION",
          numeroReservado: 5n,
          fechaEmision: diaDe(AHORA),
        }),
      );
      expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_sin_reserva" }));
      expect(traducirErroresDeFiscal(r, ["COMPROBANTE_SIN_RESERVA"])).toEqual(
        err("COMPROBANTE_SIN_RESERVA"),
      );
      expect(
        (
          await consultar<{ estado: string; envios: number }>(
            "select estado, envios from comprobante where id = $1",
            [alta.id],
          )
        )[0],
      ).toEqual({ estado: "PENDIENTE", envios: 0 });
    });

    it("autorizar sin avanzar la serie tampoco se confirma: el comprobante sigue EN_VALIDACION", async () => {
      const e = await escenario();
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta));
      await correr(comoSistemaDe(e), (tx) => entrarEnValidacion(tx, alta.id, e.empresa, AHORA));
      const r = await intentar(comoSistemaDe(e), async (tx) => {
        const c = await tx.comprobantes.obtener(empresaId(e.empresa), alta.id);
        // Se olvida de cerrar la serie: la reserva sigue siendo de este comprobante.
        return tx.comprobantes.transicionar(c!.empresaId, c!.id, c!.version, {
          a: "AUTORIZADO",
          cae: "74123456789012",
          caeVence: fechaCivil("2026-10-22"),
          autorizadoEn: AHORA,
          resueltoPor: "RESPUESTA",
        });
      });
      expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_sin_reserva" }));
      expect(
        (
          await consultar<{ estado: string }>("select estado from comprobante where id = $1", [
            alta.id,
          ])
        )[0],
      ).toEqual({ estado: "EN_VALIDACION" });
    });
  });

  // ===============================================================================================
  // 6. El camino completo del trabajo, con intento y auditoría
  // ===============================================================================================
  it("de punta a punta: crear, validar, guardar el intento antes de cerrar y autorizar, todo con su auditoría", async () => {
    const e = await escenario();
    const alta = altaDe(e);
    await correr(comoPersonaDe(e), async (tx) => {
      exito(await tx.comprobantes.crear(alta));
      await tx.auditoria.registrar({
        empresaId: empresaId(e.empresa),
        actorPersonaId: personaId(e.persona),
        accion: "COMPROBANTE_CREADO",
        entidad: "comprobante",
        entidadId: alta.id,
      });
    });
    await correr(comoSistemaDe(e), (tx) => entrarEnValidacion(tx, alta.id, e.empresa, AHORA, 100n));
    // TXi: el intento queda guardado ANTES de cerrar (es la única evidencia de un CAE si el cierre falla).
    await correr(comoSistemaDe(e), (tx) =>
      tx.intentos.registrar(intentoDe(e, alta.id, { numero: 101n })),
    );
    const autorizado = await correr(comoSistemaDe(e), async (tx) => {
      const c = await tx.comprobantes.obtener(empresaId(e.empresa), alta.id);
      await cerrarLaSerie(tx, c!, "AUTORIZADO");
      const a = await tx.comprobantes.transicionar(c!.empresaId, c!.id, c!.version, {
        a: "AUTORIZADO",
        cae: "74123456789012",
        caeVence: fechaCivil("2026-10-22"),
        autorizadoEn: AHORA,
        resueltoPor: "RESPUESTA",
      });
      await tx.auditoria.registrar({
        empresaId: empresaId(e.empresa),
        actorPersonaId: null,
        accion: "COMPROBANTE_AUTORIZADO",
        entidad: "comprobante",
        entidadId: alta.id,
      });
      return a;
    });
    expect(autorizado).toMatchObject({ estado: "AUTORIZADO", numero: 101n });
    const intentos = await correr(comoPersonaDe(e), (tx) =>
      tx.intentos.delComprobante(empresaId(e.empresa), alta.id),
    );
    expect(intentos).toHaveLength(1);
    expect(
      await cuenta(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and entidad_id = $2",
        [e.empresa, alta.id],
      ),
    ).toBe(2);
    // Una huella nueva cualquiera no coincide: la huella es del pedido, no se inventa.
    expect(huellaNueva()).not.toBe(autorizado?.huella);
    // El que ve el comprobante entero ve lo mismo que devolvió la transición.
    expect(
      await correr(comoPersonaDe(e), (tx) =>
        tx.comprobantes.obtener(empresaId(e.empresa), alta.id),
      ),
    ).toEqual(autorizado);
    // Todo lo que no es de la empresa se ve vacío con otro motivo cualquiera (control de que `errorFiscalDeRestriccion` existe).
    expect(errorFiscalDeRestriccion({ tipo: "Check", restriccion: "comprobante_inmutable" })).toBe(
      "COMPROBANTE_INMUTABLE",
    );
  });
});
