import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cobrarLaMesa,
  type DependenciasDeCobrarMesaWeb,
} from "../../src/composicion/cobrar-mesa-web";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * «Cobrar la mesa» de la web (`cobrar-mesa-web.ts`, SAL-D) contra una base real, el puerto real de caja y los roles reales: lo que sale a la pantalla (lista blanca, importes como texto), repetir con la misma clave devuelve lo cobrado,
 * dos cobros a la vez con claves distintas dejan UN ticket, el dinero cuadra al centavo (dos medios; un centavo de más o de menos no cobra), la sucursal la fija el servidor (otra sucursal o empresa no cobra ni consume número de
 * ticket), el permiso y los platos sin enviar no escriben nada, la fecha de negocio es la de la sesión de caja (23:50 y 00:10 dan la misma) y la auditoría deja quién, cuándo y qué. Todo rechazo sale como el genérico aprobado.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: cobrar la mesa", () => {
  let m: MundoDeSalon;
  const registrados: string[] = [];
  let d: DependenciasDeCobrarMesaWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = { casosDeUso: () => m.salon, respuesta: { registrar: (x) => registrados.push(x) } };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>;
  const proximaMesa = new Map<string, number>();

  /** Una mesa con su cuenta, `cantidad` unidades del producto de $ 1000 y, si se pide, ya enviada a cocina. */
  const mesaConPedido = async (e: EscenarioDeVentas, cantidad = "2", enviada = true) => {
    const n = (proximaMesa.get(e.empresa) ?? 0) + 1;
    proximaMesa.set(e.empresa, n);
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad,
      }),
    );
    if (enviada) {
      valorDe(
        await m.salon.enviarACocina(e.gerente, {
          envioId: nuevoId(),
          cuentaId,
          claveIdempotencia: nuevaClave(),
        }),
      );
    }
    return { mesaId, cuentaId };
  };

  /** Lo que arma la pantalla: clave, ids y un solo cobro en efectivo por el total. */
  const pedido = (cuentaId: string, caja: Caja, total = "2000.00", cambios = {}) => ({
    claveIdempotencia: nuevaClave(),
    cuentaId,
    ejemplarId: nuevoId(),
    totalEsperado: monto(total),
    cajaId: caja.cajaId,
    cobros: [
      { medioDePagoId: caja.medios["EFECTIVO"], cuentaDeCobroId: null, importe: monto(total) },
    ],
    ...cambios,
  });
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const rastros = async (e: EscenarioDeVentas) => ({
    tickets: await contar("ticket", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
  });
  const estadoDeLaCuenta = async (cuentaId: string) =>
    (
      await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [
        cuentaId,
      ])
    )[0]?.estado;
  const mesaLibre = async (mesaId: string) =>
    (
      await m.filas<{ n: string }>(
        "select count(*)::text as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
        [mesaId],
      )
    )[0]?.n === "0";

  it("cobra la mesa y devuelve SOLO la lista blanca (texto decimal, sin ids de más); la mesa queda libre y la auditoría dice quién y cuánto", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { mesaId, cuentaId } = await mesaConPedido(e);
    const r = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(
      [
        "cobranzaId",
        "cobros",
        "ejemplarId",
        "estado",
        "fechaNegocio",
        "numero",
        "pendienteDeFacturar",
        "ticketId",
        "total",
        "yaExistia",
      ].sort(),
    );
    expect(r.dato).toMatchObject({ estado: "COBRADO", total: monto("2000.00"), yaExistia: false });
    expect(await mesaLibre(mesaId)).toBe(true);
    expect(await estadoDeLaCuenta(cuentaId)).not.toBe("ABIERTA");
    const trazas = await m.filas<{ actor_persona_id: string; despues: Record<string, string> }>(
      "select actor_persona_id, despues from auditoria_empresa where empresa_id = $1 and accion = 'MESA_COBRADA'",
      [e.empresa],
    );
    expect(trazas).toHaveLength(1);
    expect(trazas[0]?.actor_persona_id).toBe(e.gerente.personaId);
    expect(trazas[0]?.despues).toMatchObject({ cuentaId, total: "2000.00" });
  });

  it("IDEMPOTENCIA: repetir con la misma clave devuelve lo cobrado (yaExistia) sin duplicar ticket, cobro ni auditoría; la misma clave con OTRO importe es el genérico y no cobra", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const p = pedido(cuentaId, caja);
    const primera = await cobrarLaMesa(d, e.gerente, e.sucursal, p);
    const antes = await rastros(e);
    const segunda = await cobrarLaMesa(d, e.gerente, e.sucursal, p);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    if (primera.ok && segunda.ok) {
      expect(segunda.dato.ticketId).toBe(primera.dato.ticketId);
      expect(segunda.dato.numero).toBe(primera.dato.numero);
    }
    expect(await rastros(e)).toEqual(antes);
    // La misma clave con otro pedido (otro total esperado y otro importe) no cobra ni reusa en silencio.
    const otro = await cobrarLaMesa(d, e.gerente, e.sucursal, {
      ...p,
      totalEsperado: monto("1000.00"),
      cobros: [{ ...p.cobros[0], importe: monto("1000.00") }],
    });
    expect(otro).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
  });

  it("DOS ACTORES: dos mozos cobran la misma mesa a la vez con claves distintas: UN ticket, UN cobro y UNA auditoría; el otro recibe el genérico", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { mesaId, cuentaId } = await mesaConPedido(e);
    const [a, b] = await Promise.all([
      cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja)),
      cobrarLaMesa(d, e.administrador, e.sucursal, pedido(cuentaId, caja)),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toMatchObject([GENERICO]);
    expect(await rastros(e)).toMatchObject({ tickets: 1, cobranzas: 1 });
    expect(
      await m.contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'MESA_COBRADA'",
        [e.empresa],
      ),
    ).toBe(1);
    expect(await mesaLibre(mesaId)).toBe(true);
  });

  it("DOS ACTORES: cobrar a la vez que otro agrega un plato: o se cobra lo que se vio o el cobro es el genérico; nunca un ticket que deje afuera un ítem", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const [cobro, agregado] = await Promise.all([
      cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja)),
      m.salon.agregarAlPedido(e.administrador, {
        cuentaId,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ]);
    const lineasEnElTicket = async () =>
      m.contar(
        "select count(*) as n from linea_cuenta l join cuenta_consumo c on c.id = l.cuenta_id where l.cuenta_id = $1 and l.estado = 'VIGENTE' and c.estado <> 'ABIERTA'",
        [cuentaId],
      );
    if (cobro.ok) {
      // Se cobró lo que se vio: la línea agregada después no entró en un ticket cerrado (o se rechazó).
      expect(cobro.dato.total).toEqual(monto("2000.00"));
      expect(await lineasEnElTicket()).toBe(agregado.ok ? 2 : 1);
    } else {
      expect(cobro).toMatchObject(GENERICO);
      expect(await rastros(e)).toMatchObject({ tickets: 0 });
    }
  });

  it("DINERO: dos medios que suman exacto cobran; un centavo de más o de menos es el genérico y no escribe; un total que no es el que se vio no cobra", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const dosMedios = (cuentaId: string, efectivo: string, tarjeta: string) =>
      pedido(cuentaId, caja, "2000.00", {
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"],
            cuentaDeCobroId: null,
            importe: monto(efectivo),
          },
          {
            medioDePagoId: caja.medios["TARJETA_DEBITO"],
            cuentaDeCobroId: null,
            importe: monto(tarjeta),
          },
        ],
      });
    const { cuentaId } = await mesaConPedido(e);
    const vacio = await rastros(e);
    expect(
      await cobrarLaMesa(d, e.gerente, e.sucursal, dosMedios(cuentaId, "1500.00", "500.01")),
    ).toMatchObject(GENERICO);
    expect(
      await cobrarLaMesa(d, e.gerente, e.sucursal, dosMedios(cuentaId, "1500.00", "499.99")),
    ).toMatchObject(GENERICO);
    expect(
      await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, "1999.99")),
    ).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(vacio);
    const ok = await cobrarLaMesa(
      d,
      e.gerente,
      e.sucursal,
      dosMedios(cuentaId, "1500.00", "500.00"),
    );
    expect(ok).toMatchObject({ ok: true, dato: { total: monto("2000.00") } });
    if (ok.ok) {
      expect(ok.dato.cobros.map((c) => c.importe.monto)).toEqual(["1500.00", "500.00"]);
    }
  });

  it("platos sin enviar: es el genérico y no se escribe nada (ni ticket, ni cobro, ni número consumido); enviado, se cobra", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { mesaId, cuentaId } = await mesaConPedido(e, "2", false);
    const antes = await rastros(e);
    expect(await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja))).toMatchObject(
      GENERICO,
    );
    expect(await rastros(e)).toEqual(antes);
    expect(await estadoDeLaCuenta(cuentaId)).toBe("ABIERTA");
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
    const r = await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja));
    expect(r).toMatchObject({ ok: true, dato: { numero: 1 } });
    expect(await mesaLibre(mesaId)).toBe(true);
  });

  it("AISLAMIENTO: una cuenta de otra sucursal o de otra empresa, o sin sucursal de trabajo, es el genérico: nada cobrado y ningún número de ticket consumido", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cajaOtra = await m.cajaAbierta(otra);
    const { cuentaId } = await mesaConPedido(e);
    const ajena = await mesaConPedido(otra);
    const antes = await rastros(e);
    const antesOtra = await rastros(otra);
    // Otra sucursal de la misma empresa (con alcance a ambas) y sin sucursal de trabajo.
    expect(await cobrarLaMesa(d, e.gerente, e.otraSucursal, pedido(cuentaId, caja))).toMatchObject(
      GENERICO,
    );
    expect(await cobrarLaMesa(d, e.gerente, "", pedido(cuentaId, caja))).toMatchObject(GENERICO);
    // El caso de uso sin sucursal de trabajo (un llamado que la omite) cierra: nunca compara a medias.
    const sin = pedido(cuentaId, caja);
    expect(
      await m.salon.cobrarMesa(e.gerente, {
        claveIdempotencia: sin.claveIdempotencia,
        cuentaId,
        ejemplarId: sin.ejemplarId,
        totalEsperado: sin.totalEsperado,
        cobro: { cajaId: caja.cajaId, cobros: [] },
      } as never),
    ).toEqual({ ok: false, error: "CUENTA_NO_ENCONTRADA" });
    // Una cuenta de otra empresa (y la caja de otra empresa con una cuenta propia).
    expect(
      await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(ajena.cuentaId, cajaOtra)),
    ).toMatchObject(GENERICO);
    expect(await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, cajaOtra))).toMatchObject(
      GENERICO,
    );
    expect(await rastros(e)).toEqual(antes);
    expect(await rastros(otra)).toEqual(antesOtra);
    // El primer ticket real de la empresa es el número 1: ningún rechazo consumió uno.
    expect(await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja))).toMatchObject({
      ok: true,
      dato: { numero: 1 },
    });
  });

  it("PERMISOS Y FORMA: sin persona no se cobra; una clave de más (propina, líneas, sucursal) rechaza el pedido entero; ids inválidos son el genérico", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const { cuentaId } = await mesaConPedido(e);
    const antes = await rastros(e);
    expect(
      (await cobrarLaMesa(d, { ...e.gerente, personaId: null }, e.sucursal, pedido(cuentaId, caja)))
        .ok,
    ).toBe(false);
    for (const extra of [
      { propina: monto("100.00") },
      { lineas: [] },
      { sucursalId: e.otraSucursal },
    ]) {
      expect(
        await cobrarLaMesa(d, e.gerente, e.sucursal, pedido(cuentaId, caja, "2000.00", extra)),
      ).toMatchObject(GENERICO);
    }
    expect(await cobrarLaMesa(d, e.gerente, e.sucursal, pedido("no-es-un-id", caja))).toMatchObject(
      GENERICO,
    );
    expect(
      await cobrarLaMesa(
        d,
        e.gerente,
        e.sucursal,
        pedido(cuentaId, caja, "2000.00", { claveIdempotencia: "corta" }),
      ),
    ).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
  });

  it("FECHAS: cobrar a las 23:50 y a las 00:10 con la misma sesión de caja da la misma fecha de negocio (la de la sesión), no la del reloj", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const a = await mesaConPedido(e);
    const b = await mesaConPedido(e);
    // 23:50 y 00:10 en Argentina (UTC-3) del día de la sesión y del siguiente.
    const a2350 = { ...e.gerente, ahora: new Date("2026-11-10T02:50:00Z") };
    const a0010 = { ...e.gerente, ahora: new Date("2026-11-10T03:10:00Z") };
    const x = await cobrarLaMesa(d, a2350, e.sucursal, pedido(a.cuentaId, caja));
    const y = await cobrarLaMesa(d, a0010, e.sucursal, pedido(b.cuentaId, caja));
    expect(x.ok && y.ok).toBe(true);
    if (x.ok && y.ok) {
      expect(x.dato.fechaNegocio).toBe(caja.fechaDeNegocio);
      expect(y.dato.fechaNegocio).toBe(caja.fechaDeNegocio);
    }
  });
});
