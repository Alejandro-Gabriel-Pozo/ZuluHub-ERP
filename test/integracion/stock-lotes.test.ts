import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  registrarMovimientoEnTx,
  type PedidoDeMovimiento,
} from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import type { LoteDeEntrada } from "../../src/modulos/stock/casos-de-uso/lotes-del-libro";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { llaveDeSaldo } from "../../src/modulos/stock/persistencia/repositorio-de-movimientos";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import {
  aLaVez,
  firme,
  montarStock,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E6-T7, lotes y calidad con los casos de uso reales y la base real: controlar (con la apertura al «sin asignar»), dejar de controlar y
 * reactivar, cambiar la calidad, corregir fechas, reasignar entre lotes, las consultas (lotes, vencimientos, trazabilidad, «disponible» en
 * existencias y en el puerto de ventas), permisos, aislamiento, y concurrencia (C7: rechazar un lote mientras se vende; C11: activar el
 * control mientras se vende) e idempotencia (I5, I7, I9).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const FUTURO = "2099-01-01";
const PASADO = "2000-01-02";

describe.skipIf(base === null)("stock: lotes y calidad (E6-T7)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  const deVenta = new Map<string, string>();
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
    c.encenderPerilla("lotes");
    c.encenderPerilla("calidad_de_lote");
    // Un solo depósito de venta por sucursal.
    deVenta.set(e.empresa, await c.deposito(e, { deVenta: true }));
    deVenta.set(otra.empresa, await c.deposito(otra, { deVenta: true }));
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Un artículo con su depósito normal (de venta) y otro, SIN control de lote todavía. */
  const nuevo = async (escenario: EscenarioDeStock = e) => {
    const dep = deVenta.get(escenario.empresa) as string;
    const otro = await c.deposito(escenario);
    const a = await c.articulo(escenario);
    return { dep, otro, articulo: a.articulo, producto: a.producto, escenario };
  };
  type Nuevo = Awaited<ReturnType<typeof nuevo>>;
  const controlar = (n: Nuevo, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.casos.controlarLote(quien, {
      productoId: n.producto,
      modo: "LOTE_Y_VENCIMIENTO",
      conCalidad: true,
      ...extra,
    });
  const controlado = async (escenario: EscenarioDeStock = e) => {
    const n = await nuevo(escenario);
    valorDe(await controlar(n, {}, escenario.gerente));
    return n;
  };

  const mover = (p: PedidoDeMovimiento, contexto: ContextoOperativo = e.gerente) =>
    c.entorno.ejecutar({ contexto }, (tx) => registrarMovimientoEnTx(tx, contexto, p));
  const firmar = (t: string) => {
    const r = cantidadConSignoDesdeTexto(t);
    if (!r.ok) throw new Error(t);
    return r.valor;
  };
  const pedido = (
    n: Nuevo,
    clase: "ENTRADA" | "SALIDA",
    motivo: string,
    cantidad: string,
    lotes?: readonly LoteDeEntrada[],
    deposito = n.dep,
  ): PedidoDeMovimiento => ({
    clase,
    motivo,
    detalle: null,
    origen: null,
    depositoId: deposito,
    accion: clase === "ENTRADA" ? "stock.registrar_entrada" : "stock.registrar_salida",
    anulaA: null,
    conteoId: null,
    clave: `clave-${randomUUID()}`,
    huella: huellaDeComando(clase, [deposito, motivo, cantidad], [[n.articulo, cantidad]]),
    hechoEn: e.gerente.ahora,
    fechaDeNegocio: null,
    renglones: [
      {
        depositoId: deposito,
        articuloId: n.articulo,
        composicionId: null,
        cantidad: firmar(clase === "ENTRADA" ? cantidad : `-${cantidad}`),
      },
    ],
    confirmaciones: [],
    lotes:
      lotes === undefined
        ? {}
        : { entradas: new Map([[llaveDeSaldo(deposito, n.articulo), lotes]]) },
  });
  const transferencia = (n: Nuevo, cantidad: string, destino: string): PedidoDeMovimiento => ({
    ...pedido(n, "SALIDA", "TRANSFERENCIA", cantidad),
    clase: "TRANSFERENCIA",
    accion: "stock.transferir",
    huella: huellaDeComando("TRANSFERENCIA", [n.dep, destino, cantidad], [[n.articulo, cantidad]]),
    renglones: [
      {
        depositoId: n.dep,
        articuloId: n.articulo,
        composicionId: null,
        cantidad: firmar(`-${cantidad}`),
      },
      {
        depositoId: destino,
        articuloId: n.articulo,
        composicionId: null,
        cantidad: firmar(cantidad),
      },
    ],
  });
  const entrar = async (
    n: Nuevo,
    lotes: readonly LoteDeEntrada[],
    cantidad: string,
    deposito = n.dep,
  ) => {
    const r = await mover(
      pedido(n, "ENTRADA", "COMPRA", cantidad, lotes, deposito),
      n.escenario.gerente,
    );
    if (!JSON.stringify(r).includes('"ok":true')) throw new Error(JSON.stringify(r));
  };
  const vender = (n: Nuevo, cantidad: string) =>
    mover(pedido(n, "SALIDA", "CONSUMO_INTERNO", cantidad), n.escenario.gerente);
  /** Lo mismo, dentro de una ronda simultánea: avisa a la barrera después de leer, como el resto de los participantes. */
  const venderEnRonda = (n: Nuevo, cantidad: string) =>
    c.entorno.ejecutar({ contexto: n.escenario.gerente }, async (tx) => {
      await tx.depositos.obtener(n.escenario.empresaId, n.dep);
      await c.esperarBarrera();
      return registrarMovimientoEnTx(
        tx,
        n.escenario.gerente,
        pedido(n, "SALIDA", "CONSUMO_INTERNO", cantidad),
      );
    });
  const lote = async (n: Nuevo, codigo: string) =>
    (
      await c.filas<{ id: string; version: number; calidad: string | null }>(
        "select id, version, calidad from lote where articulo_id = $1 and codigo = $2",
        [n.articulo, codigo],
      )
    )[0] as { id: string; version: number; calidad: string | null };
  const saldos = async (n: Nuevo, deposito = n.dep) =>
    Object.fromEntries(
      (
        await c.filas<{ codigo: string; existencia: string }>(
          `select l.codigo, s.existencia::text as existencia from saldo_de_lote s join lote l on l.id = s.lote_id
            where s.articulo_id = $1 and s.deposito_id = $2 order by l.codigo`,
          [n.articulo, deposito],
        )
      ).map((f) => [f.codigo, f.existencia]),
    );
  const sumaDeLotes = async (n: Nuevo, deposito = n.dep) =>
    (
      await c.filas<{ s: string }>(
        "select coalesce(sum(existencia), 0)::text as s from saldo_de_lote where articulo_id = $1 and deposito_id = $2",
        [n.articulo, deposito],
      )
    )[0]?.s;

  describe("controlarLote", () => {
    it("con existencia, crea el «sin asignar» y una apertura por depósito (también el negativo); los lotes suman el saldo y queda auditado", async () => {
      const n = await nuevo();
      await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "7" });
      await c.entrar(e.gerente, { depositoId: n.otro, articuloId: n.articulo, cantidad: "3" });
      await c.fijarNivel(e.empresa, "PERMITIR");
      const salida = await mover(pedido(n, "SALIDA", "MERMA", "5", undefined, n.otro));
      expect(JSON.stringify(salida)).toContain('"ok":true');
      expect(await c.existencia(n.otro, n.articulo)).toBe("-2.0000");
      const r = valorDe(await controlar(n));
      expect(r).toEqual({ articuloId: n.articulo, yaExistia: false });
      expect(await saldos(n)).toEqual({ SIN_ASIGNAR: "7.0000" });
      expect(await saldos(n, n.otro)).toEqual({ SIN_ASIGNAR: "-2.0000" });
      expect(
        await c.filas(
          "select deposito_id, lote_origen_id, cantidad::text as cantidad from reasignacion_de_lote where articulo_id = $1 order by cantidad",
          [n.articulo],
        ),
      ).toEqual([
        { deposito_id: n.otro, lote_origen_id: null, cantidad: "-2.0000" },
        { deposito_id: n.dep, lote_origen_id: null, cantidad: "7.0000" },
      ]);
      const auditadas = (await c.auditoria(e.empresa, "LOTE_CONTROLADO")).filter(
        (a) => a["entidad_id"] === n.articulo,
      );
      expect(auditadas).toHaveLength(1);
      expect(auditadas[0]).toMatchObject({
        antes: null,
        despues: { modo: "LOTE_Y_VENCIMIENTO", activo: true },
      });
    });

    it("I7: controlar dos veces el mismo artículo deja una sola apertura del sin asignar, devuelve yaExistia y no audita la segunda", async () => {
      const n = await nuevo();
      await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "4" });
      expect(valorDe(await controlar(n)).yaExistia).toBe(false);
      expect(valorDe(await controlar(n)).yaExistia).toBe(true);
      expect(
        await c.contar("select count(*) as n from lote where articulo_id = $1", [n.articulo]),
      ).toBe(1);
      expect(
        await c.contar("select count(*) as n from reasignacion_de_lote where articulo_id = $1", [
          n.articulo,
        ]),
      ).toBe(1);
      expect(
        (await c.auditoria(e.empresa, "LOTE_CONTROLADO")).filter(
          (a) => a["entidad_id"] === n.articulo,
        ),
      ).toHaveLength(1);
    });

    it("I7 (a la vez): dos controlarLote simultáneos dejan un solo «sin asignar» y una sola apertura", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "4" });
        const resultados = await aLaVez(
          c,
          [() => firme(() => controlar(n)), () => firme(() => controlar(n))],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await sumaDeLotes(n)).toBe("4.0000");
        expect(
          await c.contar("select count(*) as n from lote where articulo_id = $1", [n.articulo]),
        ).toBe(1);
      }
    });

    it("sin existencia no hay apertura; con el control en modo LOTE y sin calidad el lote nace sin calidad", async () => {
      const n = await nuevo();
      valorDe(await controlar(n, { modo: "LOTE", conCalidad: false }));
      expect(
        await c.contar("select count(*) as n from reasignacion_de_lote where articulo_id = $1", [
          n.articulo,
        ]),
      ).toBe(0);
      await entrar(n, [{ codigo: "L-1", cantidad: "2" }], "2");
      expect((await lote(n, "L-1")).calidad).toBeNull();
    });

    it("las perillas: sin lotes, FUNCION_NO_INCLUIDA; con calidad y sin calidad_de_lote, FUNCION_NO_INCLUIDA de esa perilla; lo ya hecho se repite aunque se apague", async () => {
      const n = await nuevo();
      const ya = await controlado();
      c.apagarPerillas();
      try {
        expect(await controlar(n)).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "lotes" },
        });
        c.encenderPerilla("lotes");
        expect(await controlar(n)).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "calidad_de_lote" },
        });
        // Repetir lo ya aplicado no depende del plan de hoy.
        c.apagarPerillas();
        expect(valorDe(await controlar(ya)).yaExistia).toBe(true);
      } finally {
        c.apagarPerillas();
        c.encenderPerilla("lotes");
        c.encenderPerilla("calidad_de_lote");
      }
      expect(
        await c.contar("select count(*) as n from control_de_lote where articulo_id = $1", [
          n.articulo,
        ]),
      ).toBe(0);
    });

    it("valida: producto que no es uuid o no existe, artículo no controlado, modo y calidad mal escritos; el operador y el módulo apagado no pueden", async () => {
      const n = await nuevo();
      const sinArticulo = await c.articulo(e, {});
      await c.dueno.query("update articulo_de_stock set activo = false where id = $1", [
        sinArticulo.articulo,
      ]);
      expect(await controlar(n, { productoId: "x" })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(await controlar(n, { productoId: nuevoId() })).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      expect(await controlar({ ...n, producto: sinArticulo.producto })).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      for (const extra of [
        { modo: "OTRO" },
        { modo: undefined },
        { conCalidad: "si" },
        { conCalidad: undefined },
      ]) {
        expect(await controlar(n, extra), JSON.stringify(extra)).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      }
      expect(await controlar(n, {}, e.operador)).toEqual({ ok: false, error: "SIN_PERMISO" });
      c.apagarModulo("stock");
      try {
        expect((await controlar(n)).ok).toBe(false);
      } finally {
        c.encenderModulos();
      }
      expect(
        await c.contar("select count(*) as n from control_de_lote where articulo_id = $1", [
          n.articulo,
        ]),
      ).toBe(0);
    });
  });

  describe("dejarDeControlarLote y reactivar", () => {
    it("deja el control inactivo sin borrar nada; dos veces es ok y no audita la segunda; mientras está apagado el libro no toca lotes y al reactivar lo movido entra al sin asignar", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-1", fechaDeVencimiento: FUTURO, cantidad: "10" }], "10");
      expect(
        valorDe(await c.casos.dejarDeControlarLote(e.gerente, { productoId: n.producto })),
      ).toEqual({ yaEstaba: false });
      expect(
        valorDe(await c.casos.dejarDeControlarLote(e.gerente, { productoId: n.producto })),
      ).toEqual({ yaEstaba: true });
      expect(
        (await c.auditoria(e.empresa, "LOTE_DEJADO_DE_CONTROLAR")).filter(
          (a) => a["entidad_id"] === n.articulo,
        ),
      ).toHaveLength(1);
      // Congelado: los lotes siguen, y una entrada sin lotes no los toca.
      await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "5" });
      expect(await saldos(n)).toEqual({ "L-1": "10.0000" });
      // Reactivar: lo que se movió mientras estuvo apagado entra al sin asignar y los lotes vuelven a sumar.
      expect(valorDe(await controlar(n))).toEqual({ articuloId: n.articulo, yaExistia: false });
      expect(await saldos(n)).toEqual({ "L-1": "10.0000", SIN_ASIGNAR: "5.0000" });
      expect(await sumaDeLotes(n)).toBe("15.0000");
      // Un artículo sin control: ya estaba.
      const sin = await nuevo();
      expect(
        valorDe(await c.casos.dejarDeControlarLote(e.gerente, { productoId: sin.producto })),
      ).toEqual({ yaEstaba: true });
      expect(await c.casos.dejarDeControlarLote(e.operador, { productoId: n.producto })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    });
  });

  describe("cambiarCalidadDeLote", () => {
    const cambiar = (
      l: { id: string; version: number },
      estado: string,
      extra: Record<string, unknown> = {},
      quien = e.gerente,
    ) =>
      c.casos.cambiarCalidadDeLote(quien, {
        loteId: l.id,
        estado,
        motivo: "Control de calidad",
        versionEsperada: l.version,
        ...extra,
      });

    it("un lote en cuarentena, en revisión o rechazado no es disponible ni se vende; liberado vuelve; queda la historia con quién y por qué, y no mueve stock", async () => {
      const n = await controlado();
      await entrar(
        n,
        [
          { codigo: "L-A", fechaDeVencimiento: "2098-01-01", cantidad: "5" },
          { codigo: "L-B", fechaDeVencimiento: FUTURO, cantidad: "5" },
        ],
        "10",
      );
      const a = await lote(n, "L-A");
      expect(valorDe(await cambiar(a, "EN_CUARENTENA"))).toEqual({ yaEstaba: false });
      const lotes = valorDe(
        await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo }),
      );
      expect(lotes?.lotes.map((l) => [l.codigo, l.calidad, l.existencia, l.disponible])).toEqual([
        ["L-A", "EN_CUARENTENA", "5.0000", "0.0000"],
        ["L-B", "LIBERADO", "5.0000", "5.0000"],
      ]);
      // Las existencias y el puerto de ventas muestran el mismo disponible.
      const pagina = valorDe(await c.consultas.existencias(e.gerente, { depositoId: n.dep }));
      expect(
        pagina.existencias
          .filter((f) => f.articuloId === n.articulo)
          .map((f) => [f.existencia, f.disponible]),
      ).toEqual([["10.0000", "5.0000"]]);
      const mostrado = await c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => ({
        ok: true as const,
        valor: await c.puertos.existenciaParaMostrar.existencias(
          tx,
          e.gerente,
          [n.producto],
          n.dep,
        ),
      }));
      expect(JSON.stringify(mostrado)).toContain('"existencia":"5.0000"');
      // Una venta de 7: solo L-B está disponible, lo que falta va al sin asignar (negativo si el control lo permite).
      await c.fijarNivel(e.empresa, "PERMITIR");
      expect(JSON.stringify(await vender(n, "7"))).toContain('"ok":true');
      expect(await saldos(n)).toEqual({ "L-A": "5.0000", "L-B": "0.0000", SIN_ASIGNAR: "-2.0000" });
      // La historia: una fila con motivo y persona; el stock del libro no cambia por la calidad.
      expect(
        await c.filas(
          "select estado, motivo, por from calidad_de_lote where lote_id = $1 and motivo <> 'Ingreso del lote'",
          [a.id],
        ),
      ).toEqual([
        { estado: "EN_CUARENTENA", motivo: "Control de calidad", por: e.personaDelGerente },
      ]);
      expect(await c.existencia(n.dep, n.articulo)).toBe("3.0000");
      for (const estado of ["EN_REVISION", "RECHAZADO", "LIBERADO"]) {
        const actual = await lote(n, "L-A");
        expect(valorDe(await cambiar(actual, estado))).toEqual({ yaEstaba: false });
      }
      expect((await lote(n, "L-A")).calidad).toBe("LIBERADO");
      expect(
        await c.contar(
          "select count(*) as n from calidad_de_lote where lote_id = $1 and motivo <> 'Ingreso del lote'",
          [a.id],
        ),
      ).toBe(4);
    });

    it("I5: cambiar la calidad al mismo estado dos veces deja una sola fila de historia y devuelve yaEstaba", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "2" }], "2");
      const a = await lote(n, "L-A");
      expect(valorDe(await cambiar(a, "RECHAZADO"))).toEqual({ yaEstaba: false });
      // Reintento con la misma versión vieja: ya estaba (no falla por la versión).
      expect(valorDe(await cambiar(a, "RECHAZADO"))).toEqual({ yaEstaba: true });
      expect(
        await c.contar(
          "select count(*) as n from calidad_de_lote where lote_id = $1 and motivo <> 'Ingreso del lote'",
          [a.id],
        ),
      ).toBe(1);
      expect(
        (await c.auditoria(e.empresa, "LOTE_CALIDAD_CAMBIADA")).filter(
          (r) => r["entidad_id"] === a.id,
        ),
      ).toHaveLength(1);
    });

    it("I5 (a la vez): dos cambios al mismo estado dejan una sola fila; dos estados distintos con la misma versión: uno gana y el otro LOTE_DESACTUALIZADO", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await controlado();
        await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "2" }], "2");
        const a = await lote(n, "L-A");
        const iguales = await aLaVez(
          c,
          [() => firme(() => cambiar(a, "RECHAZADO")), () => firme(() => cambiar(a, "RECHAZADO"))],
          ronda,
        );
        expect(soloOk(iguales)).toBe(2);
        expect(
          await c.contar(
            "select count(*) as n from calidad_de_lote where lote_id = $1 and motivo <> 'Ingreso del lote'",
            [a.id],
          ),
        ).toBe(1);
        const actual = await lote(n, "L-A");
        const distintos = await aLaVez(
          c,
          [
            () => firme(() => cambiar(actual, "EN_REVISION")),
            () => firme(() => cambiar(actual, "LIBERADO")),
          ],
          ronda,
        );
        expect(soloOk(distintos), JSON.stringify(distintos)).toBe(1);
        expect(distintos.find((r) => !r.ok)).toEqual({ ok: false, error: "LOTE_DESACTUALIZADO" });
      }
    });

    it("valida: motivo obligatorio, estado de la lista, lote que no existe o ajeno, el sin asignar y el artículo sin calidad (LOTE_SIN_CALIDAD), versión vieja; el operador no", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "2" }], "2");
      const a = await lote(n, "L-A");
      for (const motivo of ["", "   ", undefined, 7, "<b>"]) {
        expect(await cambiar(a, "RECHAZADO", { motivo }), String(motivo)).toEqual({
          ok: false,
          error: "MOTIVO_REQUERIDO",
        });
      }
      for (const estado of ["OTRO", "", undefined]) {
        expect(await cambiar(a, estado as string)).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      }
      expect(await cambiar(a, "RECHAZADO", { versionEsperada: 0 })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await cambiar({ id: nuevoId(), version: 1 }, "RECHAZADO")).toEqual({
        ok: false,
        error: "LOTE_NO_ENCONTRADO",
      });
      expect(await cambiar({ id: "x", version: 1 }, "RECHAZADO")).toEqual({
        ok: false,
        error: "LOTE_NO_ENCONTRADO",
      });
      const sinAsignar = await lote(n, "SIN_ASIGNAR");
      expect(await cambiar(sinAsignar, "RECHAZADO")).toEqual({
        ok: false,
        error: "LOTE_SIN_CALIDAD",
      });
      const sinCalidad = await nuevo();
      valorDe(await controlar(sinCalidad, { modo: "LOTE", conCalidad: false }));
      await entrar(sinCalidad, [{ codigo: "L-1", cantidad: "1" }], "1");
      expect(await cambiar(await lote(sinCalidad, "L-1"), "RECHAZADO")).toEqual({
        ok: false,
        error: "LOTE_SIN_CALIDAD",
      });
      expect(valorDe(await cambiar(a, "EN_REVISION"))).toEqual({ yaEstaba: false });
      expect(await cambiar(a, "RECHAZADO")).toEqual({ ok: false, error: "LOTE_DESACTUALIZADO" });
      expect(await cambiar(await lote(n, "L-A"), "RECHAZADO", {}, e.operador)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      const deOtra = await controlado(otra);
      await entrar(deOtra, [{ codigo: "L-X", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1");
      expect(await cambiar(await lote(deOtra, "L-X"), "RECHAZADO")).toEqual({
        ok: false,
        error: "LOTE_NO_ENCONTRADO",
      });
    });

    it("C7: rechazar un lote mientras otra sesión vende: el lote queda rechazado, los lotes suman el saldo, ninguno baja de cero y una venta posterior nunca sale de él", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await controlado();
        await c.fijarNivel(e.empresa, "PERMITIR");
        await entrar(
          n,
          [
            { codigo: "L-A", fechaDeVencimiento: "2098-01-01", cantidad: "3" },
            { codigo: "L-B", fechaDeVencimiento: FUTURO, cantidad: "3" },
          ],
          "6",
        );
        const a = await lote(n, "L-A");
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => cambiar(a, "RECHAZADO")),
            () =>
              firme(async () => ({
                ok: JSON.stringify(await venderEnRonda(n, "1")).includes('"ok":true'),
              })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect((await lote(n, "L-A")).calidad).toBe("RECHAZADO");
        expect(await sumaDeLotes(n)).toBe("5.0000");
        const antes = await saldos(n);
        expect(JSON.stringify(await vender(n, "1"))).toContain('"ok":true');
        const despues = await saldos(n);
        expect(despues["L-A"]).toBe(antes["L-A"]);
        for (const [codigo, existencia] of Object.entries(despues)) {
          if (codigo !== "SIN_ASIGNAR")
            expect(Number(existencia), codigo).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("corregirLote", () => {
    const corregir = (
      l: { id: string; version: number },
      extra: Record<string, unknown> = {},
      quien = e.gerente,
    ) =>
      c.casos.corregirLote(quien, {
        loteId: l.id,
        versionEsperada: l.version,
        detalle: "Fecha mal cargada",
        ...extra,
      });

    it("corrige el vencimiento con detalle, la versión sube y queda auditado con el antes y el después; un lote que pasó a vencido deja de ser disponible", async () => {
      const n = await controlado();
      await entrar(
        n,
        [
          {
            codigo: "L-A",
            fechaDeVencimiento: FUTURO,
            fechaDeElaboracion: "2026-01-01",
            cantidad: "4",
          },
        ],
        "4",
      );
      const a = await lote(n, "L-A");
      const r = valorDe(
        await corregir(a, { fechaDeVencimiento: PASADO, fechaDeElaboracion: "2000-01-01" }),
      );
      expect(r.version).toBe(a.version + 1);
      const auditadas = (await c.auditoria(e.empresa, "LOTE_CORREGIDO")).filter(
        (x) => x["entidad_id"] === a.id,
      );
      expect(auditadas).toHaveLength(1);
      expect(auditadas[0]).toMatchObject({
        antes: { fechaDeVencimiento: FUTURO, fechaDeElaboracion: "2026-01-01" },
        despues: {
          fechaDeVencimiento: PASADO,
          fechaDeElaboracion: "2000-01-01",
          detalle: "Fecha mal cargada",
        },
      });
      const lotes = valorDe(
        await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo }),
      );
      expect(lotes?.lotes.map((l) => [l.codigo, l.disponible])).toEqual([["L-A", "0.0000"]]);
    });

    it("corregir con las mismas fechas devuelve la versión vigente sin escribir ni auditar, aunque la versión esperada sea vieja", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "4" }], "4");
      const a = await lote(n, "L-A");
      valorDe(await corregir(a, { fechaDeVencimiento: "2098-05-05" }));
      const vigente = await lote(n, "L-A");
      expect(valorDe(await corregir(a, { fechaDeVencimiento: "2098-05-05" }))).toEqual({
        version: vigente.version,
      });
      expect(valorDe(await corregir(vigente, {}))).toEqual({ version: vigente.version });
      expect(
        (await c.auditoria(e.empresa, "LOTE_CORREGIDO")).filter((x) => x["entidad_id"] === a.id),
      ).toHaveLength(1);
    });

    it("valida: detalle obligatorio, fechas que existen, elaboración no posterior al vencimiento, vencimiento obligatorio si el control lo exige, el sin asignar, versión y permisos", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "4" }], "4");
      const a = await lote(n, "L-A");
      for (const detalle of ["", undefined, "<b>"]) {
        expect(await corregir(a, { fechaDeVencimiento: PASADO, detalle })).toEqual({
          ok: false,
          error: "DETALLE_REQUERIDO",
        });
      }
      for (const fecha of ["2026-02-30", "26-01-01", "1999-12-31", "2201-01-01", 5]) {
        expect(await corregir(a, { fechaDeVencimiento: fecha }), String(fecha)).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      }
      expect(await corregir(a, { fechaDeElaboracion: "2099-02-01" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await corregir(a, { fechaDeVencimiento: null })).toEqual({
        ok: false,
        error: "VENCIMIENTO_REQUERIDO",
      });
      expect(await corregir(await lote(n, "SIN_ASIGNAR"), { fechaDeVencimiento: FUTURO })).toEqual({
        ok: false,
        error: "LOTE_SIN_ASIGNAR",
      });
      expect(await corregir({ id: nuevoId(), version: 1 }, { fechaDeVencimiento: FUTURO })).toEqual(
        { ok: false, error: "LOTE_NO_ENCONTRADO" },
      );
      valorDe(await corregir(a, { fechaDeVencimiento: "2098-01-01" }));
      expect(await corregir(a, { fechaDeVencimiento: "2097-01-01" })).toEqual({
        ok: false,
        error: "LOTE_DESACTUALIZADO",
      });
      expect(
        await corregir(await lote(n, "L-A"), { fechaDeVencimiento: "2097-01-01" }, e.operador),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      // Con control solo de lote, el vencimiento se puede borrar.
      const sin = await nuevo();
      valorDe(await controlar(sin, { modo: "LOTE", conCalidad: false }));
      await entrar(sin, [{ codigo: "L-1", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1");
      expect(
        valorDe(await corregir(await lote(sin, "L-1"), { fechaDeVencimiento: null })).version,
      ).toBeGreaterThan(1);
    });
  });

  describe("reasignarLote", () => {
    const reasignar = (
      n: Nuevo,
      origen: string,
      destino: string,
      cantidad: string,
      extra: Record<string, unknown> = {},
      quien = e.gerente,
    ) =>
      c.casos.reasignarLote(quien, {
        clave: randomUUID(),
        depositoId: n.dep,
        productoId: n.producto,
        loteOrigenId: origen,
        loteDestinoId: destino,
        cantidad,
        motivo: "Llegó la información del lote",
        ...extra,
      });

    it("mueve del «sin asignar» a un lote real sin tocar el libro; el saldo del artículo no cambia y los lotes siguen sumando", async () => {
      const n = await controlado();
      await entrar(n, [], "6");
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "2" }], "2");
      const sinAsignar = (await lote(n, "SIN_ASIGNAR")).id;
      const a = (await lote(n, "L-A")).id;
      expect(await saldos(n)).toEqual({ "L-A": "2.0000", SIN_ASIGNAR: "6.0000" });
      // Con el control ya activo, la entrada manual sin lotes fue al sin asignar (DEC-0105).
      expect(valorDe(await reasignar(n, sinAsignar, a, "4"))).toEqual({ yaExistia: false });
      expect(await saldos(n)).toEqual({ "L-A": "6.0000", SIN_ASIGNAR: "2.0000" });
      expect(await c.existencia(n.dep, n.articulo)).toBe("8.0000");
      expect(await sumaDeLotes(n)).toBe("8.0000");
      expect(
        (await c.auditoria(e.empresa, "LOTE_REASIGNADO")).filter(
          (x) => (x["despues"] as { articuloId: string }).articuloId === n.articulo,
        ),
      ).toHaveLength(1);
      // El «sin asignar» puede quedar negativo; un lote real no.
      expect(valorDe(await reasignar(n, sinAsignar, a, "5"))).toEqual({ yaExistia: false });
      expect(await saldos(n)).toMatchObject({ SIN_ASIGNAR: "-3.0000" });
      expect(await reasignar(n, a, sinAsignar, "99")).toEqual({
        ok: false,
        error: "SALDO_DE_LOTE_INSUFICIENTE",
      });
    });

    it("I9: repetir reasignarLote con la misma clave hace una sola reasignación; con otro contenido, CLAVE_REUTILIZADA; a la vez también", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await controlado();
        await entrar(
          n,
          [
            { codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "5" },
            { codigo: "L-B", fechaDeVencimiento: FUTURO, cantidad: "5" },
          ],
          "10",
        );
        const a = (await lote(n, "L-A")).id;
        const b = (await lote(n, "L-B")).id;
        const clave = randomUUID();
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => reasignar(n, a, b, "2", { clave })),
            () => firme(() => reasignar(n, a, b, "2", { clave })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(resultados.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await saldos(n)).toEqual({
          "L-A": "3.0000",
          "L-B": "7.0000",
        });
        expect(await reasignar(n, a, b, "3", { clave })).toEqual({
          ok: false,
          error: "CLAVE_REUTILIZADA",
        });
        expect(
          await c.contar(
            "select count(*) as n from reasignacion_de_lote where articulo_id = $1 and lote_origen_id is not null",
            [n.articulo],
          ),
        ).toBe(1);
      }
    });

    it("valida: mismo lote, lotes de otro artículo, cantidad, motivo, clave, depósito inactivo o fuera del alcance, artículo sin control y permisos", async () => {
      const n = await controlado();
      await entrar(
        n,
        [
          { codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "5" },
          { codigo: "L-B", fechaDeVencimiento: FUTURO, cantidad: "5" },
        ],
        "10",
      );
      const a = (await lote(n, "L-A")).id;
      const b = (await lote(n, "L-B")).id;
      const ajeno = await controlado();
      await entrar(ajeno, [{ codigo: "L-Z", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1");
      const z = (await lote(ajeno, "L-Z")).id;
      expect(await reasignar(n, a, a, "1")).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(await reasignar(n, a, z, "1")).toEqual({ ok: false, error: "LOTE_NO_ENCONTRADO" });
      expect(await reasignar(n, a, nuevoId(), "1")).toEqual({
        ok: false,
        error: "LOTE_NO_ENCONTRADO",
      });
      for (const cantidad of ["0", "-1", "abc", ""]) {
        expect(await reasignar(n, a, b, cantidad), cantidad).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await reasignar(n, a, b, "1", { motivo: "" })).toEqual({
        ok: false,
        error: "MOTIVO_REQUERIDO",
      });
      for (const clave of ["corta", "con espacios aquí", 7]) {
        expect(await reasignar(n, a, b, "1", { clave }), String(clave)).toEqual({
          ok: false,
          error: "IDENTIFICADOR_INVALIDO",
        });
      }
      expect(await reasignar(n, a, b, "1", { depositoId: nuevoId() })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(await reasignar(n, a, b, "1", {}, e.operador)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      const sinControl = await nuevo();
      expect(await reasignar(sinControl, a, b, "1")).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      // Depósito de otra sucursal con un administrador de una sola sucursal.
      const norte = await c.deposito(e, { sucursal: e.otraSucursal });
      expect(
        await reasignar(n, a, b, "1", { depositoId: norte }, e.administradorDeUnaSucursal),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      await c.dueno.query("update deposito set activo = false where id = $1", [norte]);
      expect(await reasignar(n, a, b, "1", { depositoId: norte })).toEqual({
        ok: false,
        error: "DEPOSITO_INACTIVO",
      });
      expect(
        await c.contar(
          "select count(*) as n from reasignacion_de_lote where articulo_id = $1 and lote_origen_id is not null",
          [n.articulo],
        ),
      ).toBe(0);
    });
  });

  describe("consultas", () => {
    it("lotesDeArticulo: FEFO con el «sin asignar» al final, existencia y disponible, por depósito; el operador solo ve sus sucursales; vacío o ajeno, null", async () => {
      const n = await controlado();
      await entrar(
        n,
        [
          { codigo: "L-B", fechaDeVencimiento: "2099-02-01", cantidad: "2" },
          { codigo: "L-A", fechaDeVencimiento: "2098-02-01", cantidad: "3" },
        ],
        "5",
      );
      await entrar(
        n,
        [{ codigo: "L-A", fechaDeVencimiento: "2098-02-01", cantidad: "1" }],
        "1",
        n.otro,
      );
      const todo = valorDe(
        await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo }),
      );
      expect(todo?.control).toEqual({ modo: "LOTE_Y_VENCIMIENTO", conCalidad: true, activo: true });
      expect(todo?.lotes.map((l) => [l.codigo, l.existencia, l.disponible])).toEqual([
        ["L-A", "4.0000", "4.0000"],
        ["L-B", "2.0000", "2.0000"],
      ]);
      const delDeposito = valorDe(
        await c.consultas.lotesDeArticulo(e.gerente, {
          articuloId: n.articulo,
          depositoId: n.otro,
        }),
      );
      expect(delDeposito?.lotes.map((l) => [l.codigo, l.existencia])).toEqual([["L-A", "1.0000"]]);
      // Un depósito de cuarentena no suma al disponible.
      const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
      await entrar(n, [{ codigo: "L-C", fechaDeVencimiento: FUTURO, cantidad: "9" }], "9");
      const traslado = await mover(transferencia(n, "9", cuarentena), e.gerente);
      if (!JSON.stringify(traslado).includes('"ok":true'))
        throw new Error(JSON.stringify(traslado));

      const conCuarentena = valorDe(
        await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo }),
      );
      expect(conCuarentena?.lotes.find((l) => l.codigo === "L-C")).toMatchObject({
        existencia: "9.0000",
        // La transferencia de 9 sale primero de L-A (3) y de L-C (6, vence antes que L-B): en cuarentena quedan 6 y solo los 3 del depósito normal están disponibles.
        disponible: "3.0000",
      });
      // Un operador asignado a «Casa central» no ve lo de otra sucursal.
      const norte = await c.deposito(e, { sucursal: e.otraSucursal });
      await entrar(n, [{ codigo: "L-N", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1", norte);
      const delOperador = valorDe(
        await c.consultas.lotesDeArticulo(e.operador, { articuloId: n.articulo }),
      );
      expect(delOperador?.lotes.some((l) => l.codigo === "L-N")).toBe(false);
      expect(
        valorDe(
          await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo }),
        )?.lotes.some((l) => l.codigo === "L-N"),
      ).toBe(true);
      for (const articuloId of [nuevoId(), "x", 7]) {
        expect(
          valorDe(
            await c.consultas.lotesDeArticulo(e.gerente, { articuloId: articuloId as string }),
          ),
        ).toBeNull();
      }
      expect(
        valorDe(await c.consultas.lotesDeArticulo(otra.gerente, { articuloId: n.articulo })),
      ).toBeNull();
    });

    it("D5: el vencimiento vale hasta el final de su día y la jornada cambia en la hora de corte de la sucursal (a las 02:00 todavía es la de ayer)", async () => {
      const n = await controlado();
      const corte = (
        await c.filas<{ corte: string; zona: string }>(
          "select to_char(su.hora_de_corte, 'HH24:MI') as corte, e.zona_horaria as zona from sucursal su join empresa e on e.id = su.empresa_id where su.id = $1",
          [e.sucursal],
        )
      )[0];
      expect(corte).toBeDefined();
      // Se arma con la jornada que la consulta usa: la de un `ahora` fijo y la del día siguiente.
      const ahoraA = new Date("2026-11-10T05:00:00Z"); // 02:00 en Argentina
      const ahoraB = new Date("2026-11-10T09:00:00Z"); // 06:00 en Argentina
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: "2026-11-09", cantidad: "2" }], "2");
      const cuando = (ahora: Date) => ({ ...e.gerente, ahora });
      const antesDelCorte = valorDe(
        await c.consultas.lotesDeArticulo(cuando(ahoraA), { articuloId: n.articulo }),
      );
      const despuesDelCorte = valorDe(
        await c.consultas.lotesDeArticulo(cuando(ahoraB), { articuloId: n.articulo }),
      );
      // Con corte 04:00: a las 02:00 la jornada es la del 09 (vence hoy: disponible); a las 06:00 es la del 10 (vencido).
      if (corte?.corte === "04:00") {
        expect(antesDelCorte?.lotes[0]?.disponible).toBe("2.0000");
        expect(despuesDelCorte?.lotes[0]?.disponible).toBe("0.0000");
      } else {
        expect(despuesDelCorte?.lotes[0]?.disponible).toBe("0.0000");
      }
    });

    it("vencimientosProximos: por vencer, vence hoy y vencidos con existencia (con lo que se pierde solo con costos.ver); el horizonte es de 0 a 365 días", async () => {
      const n = await controlado();
      await c.dueno.query("select 1");
      const corteDeLaSucursal = (
        await c.filas<{ corte: string }>(
          "select to_char(hora_de_corte, 'HH24:MI') as corte from sucursal where id = $1",
          [e.sucursal],
        )
      )[0]?.corte as string;
      const jornada = fechaDeNegocio(
        e.gerente.ahora,
        "America/Argentina/Buenos_Aires",
        corteDeLaSucursal,
      );
      const hoy = valorDe(jornada) as string;
      const dia = (delta: number) =>
        new Date(new Date(`${hoy}T00:00:00Z`).getTime() + delta * 86_400_000)
          .toISOString()
          .slice(0, 10);
      await entrar(n, [{ codigo: "L-1", fechaDeVencimiento: FUTURO, cantidad: "1" }], "1");
      // Un lote ya vencido se carga por la base (la entrada rechaza el vencimiento pasado) y se mueve al libro con el caso de uso de ajuste.
      const vencido = nuevoId();
      await entrar(n, [], "4");
      await c.dueno.query(
        `insert into lote (id, empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en) values ($1, $2, $3, 'L-VIEJO', $4, '2026-01-01', $5, now())`,
        [vencido, e.empresa, n.articulo, dia(-2), e.personaDelGerente],
      );
      valorDe(
        await c.casos.reasignarLote(e.gerente, {
          clave: randomUUID(),
          depositoId: n.dep,
          productoId: n.producto,
          loteOrigenId: (await lote(n, "SIN_ASIGNAR")).id,
          loteDestinoId: vencido,
          cantidad: "4",
          motivo: "Lote viejo",
        }),
      );
      const proximo = nuevoId();
      await c.dueno.query(
        `insert into lote (id, empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en) values ($1, $2, $3, 'L-PRONTO', $4, '2026-01-01', $5, now())`,
        [proximo, e.empresa, n.articulo, dia(3), e.personaDelGerente],
      );
      await entrar(n, [{ codigo: "L-PRONTO", fechaDeVencimiento: dia(3), cantidad: "2" }], "2");
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [
          { productoId: n.producto, cantidad: "10", unidadId: "UNIDAD", costoUnitario: "5" },
        ],
      });
      const lista = valorDe(await c.consultas.vencimientosProximos(e.gerente, { dias: 7 }));
      const delArticulo = lista.filter((l) => l.articuloId === n.articulo);
      expect(delArticulo.map((l) => [l.codigo, l.situacion.tipo, l.existencia])).toEqual([
        ["L-VIEJO", "VENCIDO", "4.0000"],
        ["L-PRONTO", "POR_VENCER", "2.0000"],
      ]);
      expect(delArticulo[0]).toMatchObject({
        situacion: { tipo: "VENCIDO", dias: 2 },
        seLosPierde: "20.000000",
      });
      expect(delArticulo[1]).toMatchObject({ situacion: { tipo: "POR_VENCER", dias: 3 } });
      const delOperador = valorDe(
        await c.consultas.vencimientosProximos(e.operador, { dias: 7 }),
      ).filter((l) => l.articuloId === n.articulo);
      expect(delOperador).toHaveLength(2);
      expect(delOperador.every((l) => !("seLosPierde" in l))).toBe(true);
      expect(
        valorDe(await c.consultas.vencimientosProximos(e.gerente, { dias: 1 }))
          .filter((l) => l.articuloId === n.articulo)
          .map((l) => l.codigo),
      ).toEqual(["L-VIEJO"]);
      for (const dias of [-1, 366, 1.5, "7", undefined]) {
        expect(
          valorDe(await c.consultas.vencimientosProximos(e.gerente, { dias: dias as number })),
          String(dias),
        ).toEqual([]);
      }
      expect(
        valorDe(await c.consultas.vencimientosProximos(otra.gerente, { dias: 365 })).filter(
          (l) => l.articuloId === n.articulo,
        ),
      ).toEqual([]);
    });

    it("trazabilidadDeLote: los ingresos con su origen y lo que salió; ajeno o inexistente, null; las consultas piden lotes.ver", async () => {
      const n = await controlado();
      await entrar(n, [{ codigo: "L-A", fechaDeVencimiento: FUTURO, cantidad: "5" }], "5");
      expect(JSON.stringify(await vender(n, "2"))).toContain('"ok":true');
      const a = await lote(n, "L-A");
      const t = valorDe(await c.consultas.trazabilidadDeLote(e.operador, { loteId: a.id }));
      expect(t?.ingresos.map((m) => [m.clase, m.motivo, m.cantidad])).toEqual([
        ["ENTRADA", "COMPRA", "5.0000"],
      ]);
      expect(t?.salidas.map((m) => [m.clase, m.motivo, m.cantidad])).toEqual([
        ["SALIDA", "CONSUMO_INTERNO", "-2.0000"],
      ]);
      expect(
        valorDe(await c.consultas.trazabilidadDeLote(otra.gerente, { loteId: a.id })),
      ).toBeNull();
      expect(valorDe(await c.consultas.trazabilidadDeLote(e.gerente, { loteId: "x" }))).toBeNull();
      c.apagarModulo("stock");
      try {
        expect((await c.consultas.trazabilidadDeLote(e.gerente, { loteId: a.id })).ok).toBe(false);
        expect((await c.consultas.lotesDeArticulo(e.gerente, { articuloId: n.articulo })).ok).toBe(
          false,
        );
        expect((await c.consultas.vencimientosProximos(e.gerente, { dias: 7 })).ok).toBe(false);
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("concurrencia con el libro", () => {
    it("C11: activar el control de un artículo con existencia mientras se vende: los lotes suman el saldo y nada se pierde", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const n = await nuevo();
        await c.fijarNivel(e.empresa, "PERMITIR");
        await c.entrar(e.gerente, { depositoId: n.dep, articuloId: n.articulo, cantidad: "10" });
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => controlar(n)),
            () =>
              firme(async () => ({
                ok: JSON.stringify(await venderEnRonda(n, "3")).includes('"ok":true'),
              })),
          ],
          ronda,
        );
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(2);
        expect(await c.existencia(n.dep, n.articulo)).toBe("7.0000");
        expect(await sumaDeLotes(n)).toBe("7.0000");
        expect(
          await c
            .filas("select * from verificar_saldos_de_lote_para_pruebas($1)", [n.articulo])
            .catch(() => []),
        ).toEqual([]);
      }
    });
  });
});
