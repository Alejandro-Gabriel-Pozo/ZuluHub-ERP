import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import { nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Cerrar una mesa a nombre de un cliente con cuenta corriente (`salon.cerrarMesaACuenta`), con los casos de uso reales, la cuenta corriente real y el rol de la aplicación: sin
 * cobro de caja, el ticket queda EMITIDO cargado a la cuenta con UN cargo en el libro y la mesa queda libre. Cubre: lo feliz, los platos sin enviar, la idempotencia (doble clic
 * y repetición), dos actores a la vez (la misma mesa; cerrar contra cobrar; dos mesas del mismo cliente con límite para una), cada error del cierre a cuenta sin escribir, uniones
 * y divisiones, aislamiento por empresa y sucursal, permisos, atomicidad con falla inyectada y la auditoría sin el nombre del cliente. El total esperado (`TOTAL_CAMBIO`) y el
 * cierre ya hecho con OTRO cliente (`CLAVE_REUTILIZADA`) los valida ventas (CC-1) y acá se prueban por la composición de salón.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("salón: cerrar la mesa a cuenta", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let proxima = 0;
  /** Falla inyectada DESPUÉS del cargo a cuenta (para probar la atomicidad). */
  let falla: "NINGUNA" | "EN_LA_AUDITORIA" = "NINGUNA";

  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base, {
      conexiones: 16,
      cuentaCorriente: true,
      ajustarTx: (tx) => ({
        ...tx,
        auditoria: {
          registrar: async (registro) => {
            if (falla === "EN_LA_AUDITORIA" && registro.accion === "MESA_CERRADA_A_CUENTA") {
              throw new Error("falla inyectada en la auditoría");
            }
            await tx.auditoria.registrar(registro);
          },
        },
      }),
    });
    e = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const nuevaMesa = async (escenario = e) => {
    const n = ++proxima;
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(escenario.gerente, {
        mesaId: id,
        sucursalId: escenario.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return id;
  };
  /** Una mesa con un plato de $ 1000, enviado a cocina salvo que se pida lo contrario. */
  const mesaConPlato = async (escenario = e, enviado = true) => {
    const mesaId = await nuevaMesa(escenario);
    const cuenta = valorDe(
      await m.salon.tomarPedido(escenario.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    const lineaId = nuevoId();
    valorDe(
      await m.salon.agregarAlPedido(escenario.gerente, {
        cuentaId: cuenta,
        lineaId,
        productoId: escenario.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    if (enviado) {
      valorDe(
        await m.salon.enviarACocina(escenario.gerente, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: claveNueva(),
        }),
      );
    }
    return { mesaId, cuenta, lineaId };
  };
  /** Un cliente con su ficha de cuenta corriente (límite y plazo a elección). */
  const cliente = async (
    o: Partial<{ limite: string; suspendida: boolean; sinFicha: boolean }> = {},
    de: EscenarioDeVentas = e,
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [de.empresa, id],
    );
    if (o.sinFicha !== true) {
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, $3, $4, $5, $6)`,
        [de.empresa, id, o.limite ?? "100000.00", claveNueva(), HUELLA, de.gerente.personaId],
      );
      if (o.suspendida === true) {
        await m.dueno.query(
          "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
          [id],
        );
      }
    }
    return id;
  };
  const cerrar = (
    cuenta: string,
    clienteId: string,
    resto: Partial<Parameters<MundoDeSalon["salon"]["cerrarMesaACuenta"]>[1]> = {},
    contexto = e.gerente,
  ) =>
    m.salon.cerrarMesaACuenta(contexto, {
      sucursalDeTrabajo: e.sucursal,
      cuentaId: cuenta,
      ejemplarId: nuevoId(),
      clienteId,
      totalEsperado: { moneda: "ARS", monto: "1000.00" },
      ...resto,
    });
  const tickets = (cuenta: string) =>
    m.filas<{ id: string; estado: string; cargado_a_parte_id: string | null }>(
      "select id, estado, cargado_a_parte_id from ticket where cuenta_id = $1",
      [cuenta],
    );
  const asientos = (clienteId: string) =>
    m.filas<{ importe: string; naturaleza: string }>(
      "select importe::text, naturaleza from asiento_de_saldo where empresa_id = $1 and parte_id = $2 order by registrado_en, id",
      [e.empresa, clienteId],
    );
  const estado = async (cuenta: string) =>
    (
      await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [cuenta])
    )[0]?.estado;
  const auditorias = (accion: string) =>
    m.contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      e.empresa,
      accion,
    ]);
  const movimientosDeCaja = () =>
    m.contar("select count(*) as n from movimiento_caja where empresa_id = $1", [e.empresa]);

  it("FELIZ: cierra a cuenta sin cobro de caja: ticket EMITIDO cargado al cliente, UN cargo en el libro, la mesa libre y la auditoría sin el nombre", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const antesDeCaja = await movimientosDeCaja();
    const r = valorDe(await cerrar(p.cuenta, c));
    expect(r.yaEstabaCerrada).toBe(false);
    expect(await tickets(p.cuenta)).toEqual([
      { id: r.ticketId, estado: "EMITIDO", cargado_a_parte_id: c },
    ]);
    expect(await asientos(c)).toEqual([{ importe: "1000.00", naturaleza: "ORIGINAL" }]);
    expect(await movimientosDeCaja()).toBe(antesDeCaja);
    expect(
      await m.contar(
        "select count(*) as n from cobranza_de_ticket k join ticket t on t.id = k.ticket_id where t.cuenta_id = $1",
        [p.cuenta],
      ),
    ).toBe(0);
    expect(await estado(p.cuenta)).toBe("CERRADA");
    expect(await auditorias("MESA_CERRADA_A_CUENTA")).toBeGreaterThanOrEqual(1);
    const [constancia] = await m.filas<{ despues: unknown }>(
      "select despues from auditoria_empresa where empresa_id = $1 and accion = 'MESA_CERRADA_A_CUENTA' and entidad_id = $2",
      [e.empresa, r.ticketId],
    );
    expect(constancia?.despues).toMatchObject({
      cuentaId: p.cuenta,
      total: "1000.00",
      clienteId: c,
    });
    // La mesa quedó libre: se puede tomar un pedido nuevo.
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: p.mesaId }))
        .yaExistia,
    ).toBe(false);
  });

  it("PLATOS SIN ENVIAR: no cierra, no escribe y la mesa sigue abierta; enviado el plato, cierra", async () => {
    const p = await mesaConPlato(e, false);
    const c = await cliente();
    expect(await cerrar(p.cuenta, c)).toEqual({ ok: false, error: "HAY_PLATOS_SIN_ENVIAR" });
    expect(await tickets(p.cuenta)).toEqual([]);
    expect(await asientos(c)).toEqual([]);
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: p.cuenta,
        claveIdempotencia: claveNueva(),
      }),
    );
    expect((await cerrar(p.cuenta, c)).ok).toBe(true);
  });

  it("IDEMPOTENCIA: doble clic a la vez deja un ticket y un cargo; repetir devuelve el mismo ticket y no escribe ni audita", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const pedido = { ejemplarId: nuevoId() };
    const [a, b] = await Promise.all([cerrar(p.cuenta, c, pedido), cerrar(p.cuenta, c, pedido)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await tickets(p.cuenta)).toHaveLength(1);
    expect(await asientos(c)).toHaveLength(1);
    const antes = await auditorias("MESA_CERRADA_A_CUENTA");
    const otra = valorDe(await cerrar(p.cuenta, c, pedido));
    expect(otra.yaEstabaCerrada).toBe(true);
    expect(otra.ticketId).toBe(valorDe(a).ticketId);
    expect(await auditorias("MESA_CERRADA_A_CUENTA")).toBe(antes);
    expect(await asientos(c)).toHaveLength(1);
  });

  it("CONCURRENCIA: cerrar a cuenta y cobrar la MISMA mesa a la vez: nunca un ticket cargado a la cuenta Y cobrado en caja", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const caja = await m.cajaAbierta(e);
    const [aCuenta, cobrada] = await Promise.all([
      cerrar(p.cuenta, c),
      m.salon.cobrarMesa(e.gerente, {
        sucursalDeTrabajo: e.sucursal,
        claveIdempotencia: claveNueva(),
        cuentaId: p.cuenta,
        ejemplarId: nuevoId(),
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: { moneda: "ARS", monto: "1000.00" },
            },
          ],
        },
      }),
    ]);
    expect(await tickets(p.cuenta)).toHaveLength(1);
    const cargos = (await asientos(c)).length;
    const cobros = await m.contar(
      "select count(*) as n from cobranza_de_ticket k join ticket t on t.id = k.ticket_id where t.cuenta_id = $1",
      [p.cuenta],
    );
    expect(cargos + cobros, JSON.stringify([aCuenta, cobrada])).toBe(1);
  });

  it("CONCURRENCIA: dos mesas del mismo cliente a la vez con límite para una sola: una entra y la otra EXCEDE_EL_LIMITE, un solo cargo", async () => {
    const [x, y] = [await mesaConPlato(), await mesaConPlato()];
    const c = await cliente({ limite: "1500.00" });
    const resultados = await Promise.all([cerrar(x.cuenta, c), cerrar(y.cuenta, c)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, error: "EXCEDE_EL_LIMITE" }]);
    expect(await asientos(c)).toHaveLength(1);
    const [perdedora] = [x, y].filter((_, i) => !(resultados[i] as { ok: boolean }).ok);
    expect(await estado((perdedora as { cuenta: string }).cuenta)).toBe("ABIERTA");
  });

  it("ERRORES: cliente que no es cliente de la empresa, sin ficha, suspendido o con límite superado: cada uno sin escribir nada y con la mesa abierta", async () => {
    const otra = await m.escenario();
    const ajeno = await cliente({}, otra);
    const casos: ReadonlyArray<readonly [string, string]> = [
      [await cliente({ sinFicha: true }), "CLIENTE_SIN_CUENTA_HABILITADA"],
      [await cliente({ suspendida: true }), "CUENTA_SUSPENDIDA"],
      [await cliente({ limite: "500.00" }), "EXCEDE_EL_LIMITE"],
      [ajeno, "CLIENTE_NO_VALIDO"],
      [randomUUID(), "CLIENTE_NO_VALIDO"],
      ["no-es-un-id", "CLIENTE_NO_VALIDO"],
    ];
    for (const [clienteId, error] of casos) {
      const p = await mesaConPlato();
      expect(await cerrar(p.cuenta, clienteId), error).toEqual({ ok: false, error });
      expect(await tickets(p.cuenta)).toEqual([]);
      if (clienteId.length === 36) expect(await asientos(clienteId)).toEqual([]);
      expect(await estado(p.cuenta)).toBe("ABIERTA");
    }
  });

  it("EXCESO: con el motivo de quien puede aprobar entra y queda auditado; sin motivo o sin permiso de aprobar, no", async () => {
    const c = await cliente({ limite: "500.00" });
    const p = await mesaConPlato();
    expect(await cerrar(p.cuenta, c, { aprobacionDelExceso: { motivo: "   " } })).toEqual({
      ok: false,
      error: "EXCEDE_EL_LIMITE",
    });
    expect(
      await cerrar(
        p.cuenta,
        c,
        { aprobacionDelExceso: { motivo: "Cliente de confianza" } },
        e.operador,
      ),
    ).toEqual({ ok: false, error: "EXCEDE_EL_LIMITE" });
    expect(await tickets(p.cuenta)).toEqual([]);
    expect(
      (await cerrar(p.cuenta, c, { aprobacionDelExceso: { motivo: "Cliente de confianza" } })).ok,
    ).toBe(true);
    expect(await asientos(c)).toHaveLength(1);
  });

  it("TOTAL ESPERADO: si el total de ahora no es el que vio quien cierra, TOTAL_CAMBIO con el total actual y no escribe nada; con el total justo cierra", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    expect(
      await cerrar(p.cuenta, c, { totalEsperado: { moneda: "ARS", monto: "999.99" } }),
    ).toEqual({
      ok: false,
      error: { error: "TOTAL_CAMBIO", totalActual: { moneda: "ARS", monto: "1000.00" } },
    });
    expect(
      await cerrar(p.cuenta, c, { totalEsperado: { moneda: "USD", monto: "1000.00" } }),
    ).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
    expect(await tickets(p.cuenta)).toEqual([]);
    expect(await asientos(c)).toEqual([]);
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    expect((await cerrar(p.cuenta, c)).ok).toBe(true);
  });

  it("IDEMPOTENCIA CON TOTAL VIEJO Y OTRO CLIENTE: repetir el cierre con el total esperado viejo devuelve el ticket; con OTRO cliente es CLAVE_REUTILIZADA; nada se escribe de más", async () => {
    const p = await mesaConPlato();
    const [c, otro] = [await cliente(), await cliente()];
    const primera = valorDe(await cerrar(p.cuenta, c));
    const antes = await auditorias("MESA_CERRADA_A_CUENTA");
    const conTotalViejo = valorDe(
      await cerrar(p.cuenta, c, { totalEsperado: { moneda: "ARS", monto: "1.00" } }),
    );
    expect(conTotalViejo.ticketId).toBe(primera.ticketId);
    expect(conTotalViejo.yaEstabaCerrada).toBe(true);
    expect(await cerrar(p.cuenta, otro)).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await tickets(p.cuenta)).toEqual([
      { id: primera.ticketId, estado: "EMITIDO", cargado_a_parte_id: c },
    ]);
    expect(await asientos(c)).toHaveLength(1);
    expect(await asientos(otro)).toEqual([]);
    expect(await auditorias("MESA_CERRADA_A_CUENTA")).toBe(antes);
  });

  it("UNIÓN: cerrar a cuenta la mesa destino libera la mesa de reserva unida", async () => {
    const [destino, origen] = [await mesaConPlato(), await mesaConPlato()];
    valorDe(
      await m.salon.unirMesas(e.gerente, {
        sucursalDeTrabajo: e.sucursal,
        unionId: nuevoId(),
        cuentaDestinoId: destino.cuenta,
        cuentaOrigenId: origen.cuenta,
        clave: claveNueva(),
      }),
    );
    const c = await cliente();
    const r = valorDe(
      await cerrar(destino.cuenta, c, { totalEsperado: { moneda: "ARS", monto: "2000.00" } }),
    );
    expect(r.total.monto).toBe("2000.00");
    expect(await estado(destino.cuenta)).toBe("CERRADA");
    expect(await estado(origen.cuenta)).not.toBe("ABIERTA");
    expect(await asientos(c)).toEqual([{ importe: "2000.00", naturaleza: "ORIGINAL" }]);
  });

  it("DIVISIÓN: cerrar a cuenta una hija y cobrar la otra libera la mesa; la cuenta madre no se puede cerrar a cuenta", async () => {
    const p = await mesaConPlato();
    const dividida = valorDe(
      await m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId: p.cuenta,
        partes: 2,
        asignaciones: [{ lineaId: p.lineaId, forma: "COMPARTIDO", partes: [1, 2] }],
        sucursalDeTrabajo: e.sucursal,
      }),
    );
    const c = await cliente();
    expect((await cerrar(p.cuenta, c)).ok).toBe(false);
    const [h1, h2] = dividida.cuentas as ReadonlyArray<{ cuentaId: string }>;
    valorDe(
      await cerrar((h1 as { cuentaId: string }).cuentaId, c, {
        totalEsperado: { moneda: "ARS", monto: "500.00" },
      }),
    );
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    valorDe(
      await cerrar((h2 as { cuentaId: string }).cuentaId, c, {
        totalEsperado: { moneda: "ARS", monto: "500.00" },
      }),
    );
    expect(await estado(p.cuenta)).not.toBe("ABIERTA");
    expect((await asientos(c)).map((a) => a.importe)).toEqual(["500.00", "500.00"]);
  });

  it("AISLAMIENTO: una cuenta de otra empresa, de otra sucursal o sin sucursal de trabajo es CUENTA_NO_ENCONTRADA y no escribe", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const otra = await m.escenario();
    const cDeOtra = await cliente({}, otra);
    expect(await cerrar(p.cuenta, cDeOtra, {}, otra.gerente)).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await cerrar(p.cuenta, c, { sucursalDeTrabajo: nuevoId() })).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await cerrar(p.cuenta, c, { sucursalDeTrabajo: otra.sucursal })).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await tickets(p.cuenta)).toEqual([]);
    expect(await estado(p.cuenta)).toBe("ABIERTA");
  });

  it("PERMISOS: sin persona o con un id mal formado no escribe; el operador con alcance puede cerrar a cuenta (cargar a cuenta es de los tres roles)", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    expect((await cerrar(p.cuenta, c, {}, { ...e.gerente, personaId: null })).ok).toBe(false);
    expect(await cerrar("no-es-un-id", c)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
    expect(await tickets(p.cuenta)).toEqual([]);
    expect((await cerrar(p.cuenta, c, {}, e.operador)).ok).toBe(true);
  });

  it("ATOMICIDAD: si falla la auditoría después del cargo, no queda ticket, ni cargo, ni cuenta cerrada, ni número consumido; levantada la falla, el mismo pedido entra", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const pedido = { ejemplarId: nuevoId() };
    const numeros = () =>
      m.filas<{ ultimo: string }>(
        "select coalesce(max(numero), 0)::text as ultimo from ticket where empresa_id = $1",
        [e.empresa],
      );
    const antes = await numeros();
    falla = "EN_LA_AUDITORIA";
    try {
      await expect(cerrar(p.cuenta, c, pedido)).rejects.toThrow(/falla inyectada/);
    } finally {
      falla = "NINGUNA";
    }
    expect(await tickets(p.cuenta)).toEqual([]);
    expect(await asientos(c)).toEqual([]);
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    expect(await numeros()).toEqual(antes);
    expect((await cerrar(p.cuenta, c, pedido)).ok).toBe(true);
    expect(await asientos(c)).toHaveLength(1);
  });

  it("doble clic en cerrar la mesa a cuenta deja un ticket, un cargo y la mesa libre, y devuelve yaEstabaCerrada", async () => {
    const p = await mesaConPlato();
    const c = await cliente();
    const pedido = { ejemplarId: nuevoId() };
    const primera = valorDe(await cerrar(p.cuenta, c, pedido));
    const segunda = valorDe(await cerrar(p.cuenta, c, pedido));
    expect(primera.yaEstabaCerrada).toBe(false);
    expect(segunda.yaEstabaCerrada).toBe(true);
    expect(await tickets(p.cuenta)).toHaveLength(1);
    expect(await asientos(c)).toHaveLength(1);
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: p.mesaId }))
        .yaExistia,
    ).toBe(false);
  });
});
