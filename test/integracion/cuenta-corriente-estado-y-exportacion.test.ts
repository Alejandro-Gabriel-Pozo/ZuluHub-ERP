import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fuenteDeSaldoDelLibro } from "../../src/composicion/anonimizacion-de-partes";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "../../src/composicion/apoyo-de-exportacion-de-cuenta-corriente";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { armarExportarCuentaCorriente } from "../../src/modulos/cuenta_corriente/casos-de-uso/exportar-cuenta-corriente";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  COLUMNAS_DE_LA_EXPORTACION,
  armarHojaDeLaExportacion,
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
  type RotulosDeLaExportacion,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-4: el estado de cuenta de un cliente, la lista de clientes con cuenta y la exportación plana para tablas dinámicas, con una base real y los roles reales. Previene: una exportación cuya
 * suma por cliente no es el saldo del libro, un archivo armado con mitad del libro de antes y mitad de después de un cobro, un cliente que ve datos de otro (de otra empresa o de otro cliente),
 * una fecha de vencimiento corrida un día en el corte de medianoche, un permiso decidido por la pantalla y una exportación que deja constancia con los datos adentro.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

/** La transacción de la aplicación con lo que arma la composición (la ficha, el libro y el directorio sobre la misma conexión): el entorno de ventas ya la trae en tiempo de ejecución. */
type TxDeLaCuentaCorriente = TxDeCuentaCorriente &
  TxDeConsultasDeCuentaCorriente &
  TxDeEstadoDeCuenta;

const TEXTOS: RotulosDeLaExportacion = {
  hoja: "Cuenta corriente",
  columnas: Object.fromEntries(
    COLUMNAS_DE_LA_EXPORTACION.map((c) => [c, c]),
  ) as RotulosDeLaExportacion["columnas"],
  tramos: { DE_0_A_30: "0-30", DE_31_A_60: "31-60", DE_61_A_90: "61-90", MAS_DE_90: "+90" },
  origenes: { TICKET: "ticket", COBRANZA: "cobranza", OTRO: "otro" },
  estados: { VIGENTE: "vigente", ANULADO: "anulado" },
  si: "si",
  no: "no",
  clases: {},
  tiposDeMedio: {},
};

describe.skipIf(base === null)(
  "cuenta corriente de clientes: estado de cuenta y exportación (CC-4)",
  () => {
    let m: MundoDeVentas;
    let e: EscenarioDeVentas;
    let otra: EscenarioDeVentas;
    let transacciones!: Transacciones<TxDeLaCuentaCorriente>;
    let cc: Readonly<{
      consultas: ReturnType<typeof crearConsultasDeCuentaCorriente>;
      casos: ReturnType<typeof crearCasosDeUsoDeCuentaCorriente>;
    }>;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
      e = await m.escenario();
      otra = await m.escenario();
      transacciones = m.entorno as unknown as Transacciones<TxDeLaCuentaCorriente>;
      const dependencias = {
        transacciones,
        reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      };
      cc = {
        consultas: crearConsultasDeCuentaCorriente({
          ...dependencias,
          apoyo: crearApoyoDeLaExportacionDeCuentaCorriente(),
        }),
        casos: crearCasosDeUsoDeCuentaCorriente({
          ...dependencias,
          apoyoDeLaExportacion: crearApoyoDeLaExportacionDeCuentaCorriente(),
        }),
      };
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    /** Un cliente con ficha (30 días de plazo); el producto de la prueba vale $1000. */
    const cliente = async (
      de: EscenarioDeVentas = e,
      o: Partial<{ nombre: string; limite: string }> = {},
    ): Promise<string> => {
      const id = randomUUID();
      await m.dueno.query(
        `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
        [id, de.empresa, o.nombre ?? `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
      );
      await m.dueno.query(
        "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
        [de.empresa, id],
      );
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, $3, $4, $5, $6)`,
        [de.empresa, id, o.limite ?? "100000.00", claveNueva(), HUELLA, de.gerente.personaId],
      );
      return id;
    };
    const aCuenta = async (clienteId: string, de: EscenarioDeVentas = e) => {
      const { cuenta } = await cuentaConLinea(m, de, de.gerente);
      return valorDe(
        await m.casos.cerrarCuenta(de.gerente, {
          cuentaId: cuenta,
          ejemplarId: nuevoId(),
          clienteId,
          totalEsperado: { moneda: "ARS", monto: "1000.00" },
        }),
      );
    };
    const cobrar = async (
      t: Readonly<{ ticketId: string; ejemplarId: string }>,
      cobros: readonly (readonly [string, string])[] = [["EFECTIVO", "1000.00"]],
      de: EscenarioDeVentas = e,
    ) => {
      const caja = await m.cajaAbierta(de);
      return valorDe(
        await m.casos.cobrar(de.gerente, {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarId: t.ejemplarId,
          cajaId: caja.cajaId,
          cobros: cobros.map(([medio, monto]) => ({
            medioDePagoId: caja.medios[medio] as string,
            cuentaDeCobroId: null,
            importe: { moneda: "ARS", monto },
          })),
        }),
      );
    };
    const anular = async (t: Readonly<{ ticketId: string; ejemplarId: string }>) =>
      valorDe(
        await m.casos.anularTicket(e.gerente, {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarBaseId: t.ejemplarId,
          ejemplarNuevoId: nuevoId(),
          motivo: "Error del cajero",
          sucursalDeTrabajo: e.sucursal,
        }),
      );
    const saldoDelLibro = async (clienteId: string): Promise<string> =>
      (
        await m.filas<{ s: string }>(
          "select coalesce(sum(importe), 0)::text as s from asiento_de_saldo where parte_id = $1 and sentido = 'A_COBRAR'",
          [clienteId],
        )
      )[0]?.s as string;
    const el = (texto: string, de: ContextoOperativo = e.gerente): ContextoOperativo => ({
      ...de,
      ahora: new Date(texto),
    });
    const exportar = async (de: ContextoOperativo = e.gerente) =>
      valorDe(await cc.casos.exportarCuentaCorriente(de));
    const sumaPorCliente = (filas: readonly { parteId: string; importeConSigno: string }[]) => {
      const por = new Map<string, bigint>();
      for (const f of filas) {
        const centavos = BigInt(f.importeConSigno.replace(".", ""));
        por.set(f.parteId, (por.get(f.parteId) ?? 0n) + centavos);
      }
      return por;
    };
    const enTexto = (centavos: bigint): string => {
      const signo = centavos < 0n ? "-" : "";
      const abs = centavos < 0n ? -centavos : centavos;
      return `${signo}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
    };

    it("estado de cuenta: líneas con saldo corrido, cargo pendiente con su vencimiento, saldo y disponible exactos", async () => {
      const c = await cliente(e, { limite: "5000.00" });
      const cobrado = await aCuenta(c);
      await cobrar(cobrado);
      await aCuenta(c);
      const r = valorDe(await cc.consultas.verEstadoDeCuenta(e.gerente, { parteId: c }));
      expect(r.cliente.nombre).toMatch(/^Cliente /);
      expect(r.cliente.cuit).toMatch(/^\d{11}$/);
      expect(r.alDia).toBe("2026-11-09");
      expect(r.saldo).toEqual({ moneda: "ARS", monto: "1000.00" });
      expect(r.disponible).toEqual({ moneda: "ARS", monto: "4000.00" });
      expect(r.excedido).toBe(false);
      expect(r.lineas.map((l) => [l.clase, l.importe.monto, l.saldoAcumulado.monto])).toEqual([
        ["CARGO_DE_VENTA_A_CUENTA", "1000.00", "1000.00"],
        ["COBRANZA", "-1000.00", "0.00"],
        ["CARGO_DE_VENTA_A_CUENTA", "1000.00", "1000.00"],
      ]);
      expect(r.cargosPendientes).toHaveLength(1);
      expect(r.cargosPendientes[0]).toMatchObject({
        clase: "CARGO_DE_VENTA_A_CUENTA",
        fechaDeNegocio: "2026-11-09",
        venceEl: "2026-12-09",
        pendiente: { moneda: "ARS", monto: "1000.00" },
        vencida: false,
        antiguedadEnDias: 0,
      });
      // El período recorta las líneas pero no el saldo corrido.
      const fuera = valorDe(
        await cc.consultas.verEstadoDeCuenta(e.gerente, {
          parteId: c,
          desde: "2026-12-01",
          hasta: "2026-12-31",
        }),
      );
      expect(fuera.lineas).toEqual([]);
      expect(fuera.saldo.monto).toBe("1000.00");
    });

    it("la ficha dice, de cada movimiento, qué es, de qué ticket sale (número, canal y sucursal), con qué medio se cobró y si está vencido; y la lista trae la fecha del cargo abierto más antiguo", async () => {
      const c = await cliente();
      const cobrado = await aCuenta(c);
      await cobrar(cobrado, [["TARJETA_DEBITO", "1000.00"]]);
      const anulado = await aCuenta(c);
      await anular(anulado);
      await aCuenta(c);
      const numero = async (t: { ticketId: string }) =>
        (
          await m.filas<{ numero: number }>("select numero from ticket where id = $1", [t.ticketId])
        )[0]?.numero;
      const sucursal = (
        await m.filas<{ nombre: string }>("select nombre from sucursal where id = $1", [e.sucursal])
      )[0]?.nombre;
      const r = valorDe(
        await cc.consultas.verEstadoDeCuenta(el("2026-12-10T00:10:00-03:00"), { parteId: c }),
      );
      expect(
        r.lineas.map((l) => [l.tipo, l.ticket?.numero, l.ticket?.canal, l.ticket?.sucursal]),
      ).toEqual([
        ["VENTA_A_CUENTA", await numero(cobrado), "MOSTRADOR", sucursal],
        ["COBRANZA", await numero(cobrado), "MOSTRADOR", sucursal],
        ["VENTA_A_CUENTA", await numero(anulado), "MOSTRADOR", sucursal],
        ["VENTA_ANULADA", await numero(anulado), "MOSTRADOR", sucursal],
        ["VENTA_A_CUENTA", r.lineas[4]?.ticket?.numero, "MOSTRADOR", sucursal],
      ]);
      expect(r.lineas.map((l) => l.medioDePago)).toEqual([
        null,
        "TARJETA_DEBITO",
        null,
        null,
        null,
      ]);
      // «Vencida» solo el cargo que sigue con algo por saldar: el cobrado y el anulado ya no deben nada.
      expect(r.lineas.map((l) => l.vencida)).toEqual([false, false, false, false, true]);
      const lista = valorDe(
        await cc.consultas.listarClientesConCuenta(el("2026-12-10T00:10:00-03:00")),
      );
      expect(lista.clientes.find((x) => x.cuenta.parteId === c)).toMatchObject({
        fechaDelCargoMasAntiguo: "2026-11-09",
        antiguedadEnDias: 31,
      });
      const sinDeuda = await cliente();
      expect(
        valorDe(await cc.consultas.listarClientesConCuenta(e.gerente)).clientes.find(
          (x) => x.cuenta.parteId === sinDeuda,
        ),
      ).toMatchObject({ fechaDelCargoMasAntiguo: null, antiguedadEnDias: null });
    });

    it("vencida: el día del vencimiento todavía no; al día siguiente sí, también en el corte de medianoche (23:50 y 00:10 de Argentina)", async () => {
      const c = await cliente();
      await aCuenta(c);
      const estado = async (ahora: string) =>
        valorDe(await cc.consultas.verEstadoDeCuenta(el(ahora), { parteId: c }));
      const ultimoMinuto = await estado("2026-12-09T23:50:00-03:00");
      expect(ultimoMinuto.alDia).toBe("2026-12-09");
      expect(ultimoMinuto.cargosPendientes[0]).toMatchObject({
        vencida: false,
        antiguedadEnDias: 30,
      });
      const primerMinuto = await estado("2026-12-10T00:10:00-03:00");
      expect(primerMinuto.alDia).toBe("2026-12-10");
      expect(primerMinuto.cargosPendientes[0]).toMatchObject({
        vencida: true,
        antiguedadEnDias: 31,
      });
      const lista = async (ahora: string) =>
        valorDe(await cc.consultas.listarClientesConCuenta(el(ahora)));
      const suyo = (l: Awaited<ReturnType<typeof lista>>) =>
        l.clientes.find((x) => x.cuenta.parteId === c);
      expect(suyo(await lista("2026-12-09T23:50:00-03:00"))).toMatchObject({
        vencido: { monto: "0.00" },
        antiguedadEnDias: 30,
      });
      expect(suyo(await lista("2026-12-10T00:10:00-03:00"))).toMatchObject({
        vencido: { monto: "1000.00" },
        antiguedadEnDias: 31,
      });
    });

    it("la lista de clientes con cuenta se ordena por saldo, vencido o antigüedad (de mayor a menor, estable) y trae el disponible", async () => {
      const mia = await armarEmpresaAparte();
      const [alto, medio, bajo, sin] = [
        await cliente(mia, { nombre: "Zeta", limite: "10000.00" }),
        await cliente(mia, { nombre: "Beta", limite: "10000.00" }),
        await cliente(mia, { nombre: "Alfa", limite: "10000.00" }),
        await cliente(mia, { nombre: "Omega", limite: "10000.00" }),
      ] as const;
      await aCuenta(alto, mia);
      await aCuenta(alto, mia);
      await aCuenta(alto, mia);
      await aCuenta(medio, mia);
      await aCuenta(medio, mia);
      await aCuenta(bajo, mia);
      const por = async (
        orden: "SALDO" | "VENCIDO" | "ANTIGUEDAD",
        ahora = "2026-12-10T12:00:00-03:00",
      ) =>
        valorDe(
          await cc.consultas.listarClientesConCuenta(el(ahora, mia.gerente), { orden }),
        ).clientes.map((x) => x.cuenta.parteId);
      expect(await por("SALDO")).toEqual([alto, medio, bajo, sin]);
      expect(await por("VENCIDO")).toEqual([alto, medio, bajo, sin]);
      // Misma antigüedad (cargos del mismo día): desempata el nombre (Alfa, Beta, Zeta); sin deuda abierta, al final.
      expect(await por("ANTIGUEDAD")).toEqual([bajo, medio, alto, sin]);
      const lista = valorDe(await cc.consultas.listarClientesConCuenta(mia.gerente));
      expect(lista.clientes.find((x) => x.cuenta.parteId === alto)).toMatchObject({
        saldo: { monto: "3000.00" },
        disponible: { monto: "7000.00" },
        excedido: false,
      });
      expect(lista.clientes.find((x) => x.cuenta.parteId === sin)).toMatchObject({
        saldo: { monto: "0.00" },
        antiguedadEnDias: null,
      });
    });

    it("aislamiento: otra empresa no ve estos clientes (estado de cuenta sin oráculo, lista y exportación solo con lo suyo)", async () => {
      const c = await cliente();
      await aCuenta(c);
      const ajena = valorDe(await cc.consultas.listarClientesConCuenta(otra.gerente));
      expect(ajena.clientes.map((x) => x.cuenta.parteId)).not.toContain(c);
      expect(await cc.consultas.verEstadoDeCuenta(otra.gerente, { parteId: c })).toMatchObject({
        ok: false,
        error: "CUENTA_NO_ENCONTRADA",
      });
      const suyas = (await exportar(otra.gerente)).filas;
      expect(suyas.map((f) => f.parteId)).not.toContain(c);
    });

    it("permisos: un cajero (sin cuenta_corriente.ver) es rechazado en las tres operaciones y la exportación no deja constancia", async () => {
      const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
      for (const r of [
        await cc.consultas.verEstadoDeCuenta(e.operador, { parteId: randomUUID() }),
        await cc.consultas.listarClientesConCuenta(e.operador),
        await cc.casos.exportarCuentaCorriente(e.operador),
      ]) {
        expect(r).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      }
      expect((await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length).toBe(antes);
    });

    it("entradas inválidas: fechas mal formadas, desde posterior a hasta y un orden que no existe", async () => {
      const c = await cliente();
      for (const entrada of [
        { parteId: c, desde: "2026-13-01" },
        { parteId: c, hasta: "mañana" },
        { parteId: c, desde: "2026-12-31", hasta: "2026-12-01" },
      ]) {
        expect(await cc.consultas.verEstadoDeCuenta(e.gerente, entrada)).toMatchObject({
          ok: false,
          error: "FECHA_INVALIDA",
        });
      }
      expect(
        await cc.consultas.listarClientesConCuenta(e.gerente, { orden: "NOMBRE" as never }),
      ).toMatchObject({ ok: false, error: "ORDEN_INVALIDO" });
    });

    it("la suma de las filas de la exportación por cliente es EXACTAMENTE su saldo del libro (cargos, cobranza con dos medios, anulación con su espejo) y la hoja sale plana", async () => {
      const c = await cliente();
      await aCuenta(c);
      const dosMedios = await aCuenta(c);
      await cobrar(dosMedios, [
        ["EFECTIVO", "600.50"],
        ["TARJETA_DEBITO", "399.50"],
      ]);
      const aAnular = await aCuenta(c);
      await anular(aAnular);
      const { filas, clientes, alDia } = await exportar();
      expect(alDia).toBe("2026-11-09");
      expect(clientes).toBeGreaterThan(0);
      const suyas = filas.filter((f) => f.parteId === c);
      // 3 cargos + cobranza en 2 filas (una por medio) + cargo anulado con su espejo = 3 + 2 + 1.
      expect(suyas).toHaveLength(6);
      expect(sumaPorCliente(suyas).get(c)).toBe(BigInt((await saldoDelLibro(c)).replace(".", "")));
      expect(enTexto(sumaPorCliente(suyas).get(c) as bigint)).toBe("1000.00");
      const cobranza = suyas.filter((f) => f.origen === "COBRANZA");
      expect(cobranza.map((f) => [f.tipoDeMedio, f.importeConSigno]).sort()).toEqual([
        ["EFECTIVO", "-600.50"],
        ["TARJETA_DEBITO", "-399.50"],
      ]);
      expect(new Set(cobranza.map((f) => f.asientoId)).size).toBe(1);
      expect(suyas.filter((f) => f.estado === "ANULADO")).toHaveLength(2);
      expect(suyas.every((f) => f.moneda === "ARS" && f.sucursalId === e.sucursal)).toBe(true);
      const nombreDeLaSucursal = (
        await m.filas<{ nombre: string }>("select nombre from sucursal where id = $1", [e.sucursal])
      )[0]?.nombre;
      expect(suyas.every((f) => f.sucursal === nombreDeLaSucursal)).toBe(true);
      // Y lo mismo para TODOS los clientes de la exportación: ninguno se mezcla con otro.
      for (const [parteId, centavos] of sumaPorCliente(filas)) {
        expect(enTexto(centavos), parteId).toBe(await saldoDelLibro(parteId));
      }
      // El pendiente es de los cargos vigentes con algo por saldar: un cargo pendiente de $1000, el resto cero.
      expect(suyas.filter((f) => f.pendiente !== "0.00").map((f) => f.pendiente)).toEqual([
        "1000.00",
      ]);
      const hoja = armarHojaDeLaExportacion(suyas, TEXTOS);
      expect(hoja.encabezados).toEqual([...COLUMNAS_DE_LA_EXPORTACION]);
      expect(hoja.filas.every((f) => f.length === COLUMNAS_DE_LA_EXPORTACION.length)).toBe(true);
      // Cuatro tablas dinámicas por GROUP BY sobre las mismas filas: por cliente, por tramo, por sucursal y por medio; todas cierran con el saldo.
      const porClave = (clave: (f: (typeof suyas)[number]) => string) => {
        const acumulado = new Map<string, bigint>();
        for (const f of suyas) {
          acumulado.set(
            clave(f),
            (acumulado.get(clave(f)) ?? 0n) + BigInt(f.importeConSigno.replace(".", "")),
          );
        }
        return acumulado;
      };
      for (const clave of [
        (f: (typeof suyas)[number]) => f.parteId,
        (f: (typeof suyas)[number]) => f.tramoDeAntiguedad,
        (f: (typeof suyas)[number]) => f.sucursalId ?? "-",
        (f: (typeof suyas)[number]) => f.tipoDeMedio ?? "-",
      ]) {
        expect([...porClave(clave).values()].reduce((a, b) => a + b, 0n)).toBe(100000n);
      }
      // Filtrando «vigente» (se van el cargo anulado y su espejo), la suma sigue siendo la misma: el par anulado suma cero.
      expect(
        suyas
          .filter((f) => f.estado === "VIGENTE")
          .reduce((a, f) => a + BigInt(f.importeConSigno.replace(".", "")), 0n),
      ).toBe(100000n);
    });

    it("exportar dos veces da las mismas filas, deja dos registros de auditoría sin los datos y no cambia el libro", async () => {
      const c = await cliente();
      await aCuenta(c);
      const contar = () =>
        m.contar(
          "select (select count(*) from asiento_de_saldo) + (select count(*) from imputacion_de_saldo) + (select count(*) from cuenta_del_cliente) as n",
        );
      const libroAntes = await contar();
      const auditoriaAntes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
      const a = await exportar();
      const b = await exportar();
      expect(b.filas).toEqual(a.filas);
      expect(await contar()).toBe(libroAntes);
      const registros = await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA");
      expect(registros.length - auditoriaAntes).toBe(2);
      const ultimo = registros.at(-1) as Record<string, unknown>;
      expect(ultimo["actor_persona_id"]).toBe(e.gerente.personaId);
      expect(ultimo["entidad"]).toBe("exportacion_de_cuenta_corriente");
      expect(ultimo["despues"]).toEqual({
        alDia: "2026-11-09",
        clientes: a.clientes,
        filas: a.filas.length,
      });
      // Sin los datos: ni nombres ni CUIT ni importes en la constancia.
      const texto = JSON.stringify(ultimo["despues"]);
      expect(texto).not.toMatch(/Cliente |\d{11}|\d+\.\d{2}/);
    });

    it("lectura consistente: leer el estado de cuenta y exportar a la vez que se cobra y se carga nunca da un saldo distinto de la suma de las líneas", async () => {
      const c = await cliente();
      const pendientes = [await aCuenta(c), await aCuenta(c), await aCuenta(c)];
      const trabajo = (async () => {
        for (const t of pendientes) await cobrar(t);
      })();
      const lecturas = (async () => {
        for (let i = 0; i < 6; i++) {
          const r = valorDe(await cc.consultas.verEstadoDeCuenta(e.gerente, { parteId: c }));
          const suma = r.lineas.reduce((a, l) => a + BigInt(l.importe.monto.replace(".", "")), 0n);
          expect(suma).toBe(BigInt(r.saldo.monto.replace(".", "")));
          const x = (await exportar()).filas.filter((f) => f.parteId === c);
          const centavos = sumaPorCliente(x).get(c) ?? 0n;
          // Una foto: la suma de lo exportado es siempre un saldo que existió (múltiplo de los $1000 del ticket), nunca uno a medias.
          expect(centavos % 100000n).toBe(0n);
        }
      })();
      await Promise.all([trabajo, lecturas]);
      expect((await saldoDelLibro(c)).replace(".", "")).toBe("000");
    });

    it("tope: por encima del máximo de filas se rechaza el pedido entero y no se deja constancia", async () => {
      const limitada = armarExportarCuentaCorriente(
        {
          transacciones,
          reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
          apoyoDeLaExportacion: crearApoyoDeLaExportacionDeCuentaCorriente(),
        },
        1,
      );
      const c = await cliente();
      await aCuenta(c);
      await aCuenta(c);
      const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
      expect(await limitada(e.gerente)).toMatchObject({
        ok: false,
        error: "EXPORTACION_DEMASIADO_GRANDE",
      });
      expect((await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length).toBe(antes);
    });

    it("sin el apoyo de la composición, exportar se rechaza (nace cerrado) y no deja constancia", async () => {
      const sinApoyo = crearCasosDeUsoDeCuentaCorriente({
        transacciones,
        reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      });
      const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
      expect(await sinApoyo.exportarCuentaCorriente(e.gerente)).toMatchObject({
        ok: false,
        error: "EXPORTACION_NO_DISPONIBLE",
      });
      expect((await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length).toBe(antes);
    });

    it("un cliente con saldo distinto de cero tiene el impedimento de anonimizar; con el saldo en cero, el del libro desaparece (queda solo el de su ficha)", async () => {
      const c = await cliente();
      const t = await aCuenta(c);
      const impedimentos = async () =>
        transacciones.ejecutar({ contexto: e.gerente }, async (tx) =>
          ok(await fuenteDeSaldoDelLibro(tx.saldos)(e.gerente.empresaId, c)),
        );
      expect(await impedimentos()).toEqual(
        ok([{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }]),
      );
      await cobrar(t);
      expect(await impedimentos()).toEqual(ok([]));
    });

    /** Una empresa con su propio escenario, para ordenar sin mezclarse con los demás clientes de la prueba. */
    async function armarEmpresaAparte(): Promise<EscenarioDeVentas> {
      return m.escenario();
    }
  },
);
