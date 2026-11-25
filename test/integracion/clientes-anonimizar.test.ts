import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import { crearTransacciones } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  TRABAJO_PARTE_ANONIMIZADA,
  claveDeParteAnonimizada,
} from "../../src/modulos/clientes/publico";
import {
  crearRepositorioDeAsientos,
  crearRepositorioDeImputaciones,
  crearRepositorioDeSaldos,
  registrarAsientoEnTx,
  type EntradaDeAsiento,
  type SaldosDb,
  type TxDeSaldos,
} from "../../src/modulos/saldos_de_partes/publico";
import { importeDesdeTexto, type Importe } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { codigoDe } from "./concurrencia-apoyo";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  valorDe,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Anonimizar una parte (derecho de supresión; decisión del dueño, 25/11/2026) contra la base real y con las dependencias reales, incluido el libro de saldos.
 * Permisos (solo el gerente), motivo cerrado, impedimento por saldo distinto de cero (a favor o en contra), todo lo personal vacío en UNA transacción (datos, roles,
 * vínculos y cargo), auditoría y aviso SIN datos de la parte, idempotencia (dos veces, una sola escritura), concurrencia (dos anonimizaciones, contra una edición y contra un
 * asiento de saldo que llega a la vez), atomicidad con falla inyectada en el paso de copias, aislamiento entre empresas y el respaldo de la base (cargo y piso).
 * Rondas de concurrencia: `PEDERNAL_RONDAS` (3 por defecto).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const imp = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const MOTIVO = "PEDIDO_DEL_TITULAR";

describe.skipIf(base === null)("clientes: anonimizar una parte", () => {
  let c: MontajeDeClientes;
  let e: EscenarioDeClientes;
  let libro: ReturnType<typeof crearLibro>;
  let sucursal: string;
  let sur: string;

  const crearLibro = (url: string, clave: NonNullable<typeof base>["clave"]) =>
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
    c = await montarClientes(base);
    e = await c.escenario();
    libro = crearLibro(c.propia.base.app, c.propia.base.clave);
    const crearSucursal = async (nombre: string) =>
      String(
        (
          await c.filas<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.empresa, nombre],
          )
        )[0]?.id,
      );
    sucursal = await crearSucursal("Central");
    sur = await crearSucursal("Sur");
  });
  afterAll(async () => {
    if (base === null) return;
    await libro.cerrar();
    await c.cerrar();
  });

  // ---------------------------------------------------------------------------------------------
  // Apoyo
  // ---------------------------------------------------------------------------------------------
  const DATOS_PERSONALES = {
    apellido: "Quiroga",
    alias: "El Gaucho",
    documento: { tipo: "DNI", numero: "27.345.678" },
    condicionIva: "CONSUMIDOR_FINAL",
    email: "quiroga.privado@correo.com",
    telefono: "+54 11 4555-0199",
    domicilio: {
      pais: "AR",
      estructurado: {
        calle: "Mitre",
        numero: "1234",
        piso: "3",
        departamento: "B",
        localidad: "Rosario",
        provincia: "AR-S",
        codigoPostal: "2000",
      },
    },
    nota: "Pide factura A siempre",
  };
  const persona = async (extra: Record<string, unknown> = {}, quien = e.operador) =>
    valorDe(
      await c.casos.crearParte(quien, {
        idempotencia: nuevoId(),
        naturaleza: "HUMANA",
        nombre: nombreUnico("Ramón"),
        roles: ["CUSTOMER", "PROVEEDOR"],
        ...DATOS_PERSONALES,
        documento: {
          tipo: "DNI",
          numero: String(10_000_000 + numeroUnico()),
        },
        ...extra,
      }),
    ).parteId;
  const empresa = async (extra: Record<string, unknown> = {}, quien = e.operador) =>
    valorDe(
      await c.casos.crearParte(quien, {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreUnico("Empresa"),
        roles: ["PROVEEDOR"],
        documento: { tipo: "CUIT", numero: cuitUnico() },
        ...extra,
      }),
    ).parteId;
  const fila = async (id: string) =>
    (await c.filas("select * from parte where id = $1", [id]))[0] ?? null;
  const anonimizar = (parteId: string, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.casos.anonimizarParte(quien, { parteId, motivo: MOTIVO, ...extra });
  const auditadas = (parteId: string) =>
    c.filas(
      "select * from auditoria_empresa where empresa_id = $1 and entidad = 'parte' and entidad_id = $2 and accion = 'PARTE_ANONIMIZADA'",
      [e.empresa, parteId],
    );
  const avisos = (parteId: string) =>
    c.filas("select * from trabajo where empresa_id = $1 and clave_idempotencia = $2", [
      e.empresa,
      claveDeParteAnonimizada(parteId),
    ]);
  const vinculosDe = (parteId: string) =>
    c.filas(
      "select parte_id, de_parte_id, tipo, cargo, activo from parte_vinculo where parte_id = $1 or de_parte_id = $1 order by tipo, parte_id",
      [parteId],
    );
  const rolesDe = (parteId: string) =>
    c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [parteId]);
  const totalDeAuditoria = () =>
    c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [e.empresa]);
  const totalDeAvisos = () =>
    c.contar("select count(*) as n from trabajo where empresa_id = $1 and tipo = $2", [
      e.empresa,
      TRABAJO_PARTE_ANONIMIZADA,
    ]);
  const COLUMNAS_PERSONALES = [
    "nombre",
    "apellido",
    "alias",
    "documento_tipo",
    "documento_pais",
    "documento_numero",
    "condicion_iva",
    "email",
    "telefono",
    "dom_pais",
    "dom_calle",
    "dom_numero",
    "dom_piso",
    "dom_departamento",
    "dom_localidad",
    "dom_provincia",
    "dom_codigo_postal",
    "dom_texto",
    "nota",
  ] as const;

  const contextoDelLibro = (): ContextoOperativo => ({ ...e.gerente, ahora: new Date() });
  const asiento = (
    parteId: string,
    clase: "CARGO_DE_FACTURA_DE_COMPRA" | "PAGO_A_PROVEEDOR",
    importe: string,
    centro: string = sucursal,
  ): EntradaDeAsiento => ({
    parteId,
    sentido: "A_PAGAR",
    clase,
    importe: imp(importe),
    origen: {
      tipo: clase === "PAGO_A_PROVEEDOR" ? "compras.pago" : "compras.factura",
      id: randomUUID(),
    },
    clave: randomUUID(),
    hechoEn: new Date("2026-11-25T12:00:00Z"),
    distribucion: [{ centroDeCosto: centro, importe: imp(importe) }],
  });
  const asentar = (
    parteId: string,
    clase: "CARGO_DE_FACTURA_DE_COMPRA" | "PAGO_A_PROVEEDOR",
    importe: string,
    centro: string = sucursal,
  ) =>
    libro.ejecutar({ contexto: contextoDelLibro() }, (tx) =>
      registrarAsientoEnTx(tx, contextoDelLibro(), asiento(parteId, clase, importe, centro)),
    );
  const saldoDe = async (parteId: string) =>
    String(
      (
        await c.filas<{ s: string }>(
          "select coalesce(sum(saldo), 0)::text as s from saldo_de_parte where parte_id = $1",
          [parteId],
        )
      )[0]?.s,
    );

  // =============================================================================================
  describe("permisos y motivo", () => {
    it("solo el gerente anonimiza: el administrador y el operador reciben SIN_PERMISO y no cambia nada (guard primero: ni se miran las copias)", async () => {
      const id = await persona();
      const llamadas: string[] = [];
      c.pasosDeCopias.push((_, parteId) => {
        llamadas.push(parteId);
        return Promise.resolve(ok(null));
      });
      try {
        const antes = await fila(id);
        const auditoriaAntes = await totalDeAuditoria();
        for (const quien of [e.administrador, e.operador]) {
          expect(await anonimizar(id, {}, quien)).toEqual({ ok: false, error: "SIN_PERMISO" });
        }
        expect(await fila(id)).toEqual(antes);
        expect(await totalDeAuditoria()).toBe(auditoriaAntes);
        expect(await avisos(id)).toEqual([]);
        expect(llamadas).toEqual([]);
        expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
        expect(llamadas).toEqual([id]);
      } finally {
        c.pasosDeCopias.length = 0;
      }
    });

    it("el motivo es de una lista cerrada: otro valor (o ninguno) es MOTIVO_DE_ANONIMIZACION_INVALIDO y no cambia nada", async () => {
      const id = await persona();
      const antes = await fila(id);
      for (const motivo of ["", "pedido_del_titular", "OTRO", "constructor", "__proto__"]) {
        expect(await anonimizar(id, { motivo })).toEqual({
          ok: false,
          error: "MOTIVO_DE_ANONIMIZACION_INVALIDO",
        });
      }
      expect(await c.casos.anonimizarParte(e.gerente, { parteId: id } as never)).toEqual({
        ok: false,
        error: "MOTIVO_DE_ANONIMIZACION_INVALIDO",
      });
      expect(await fila(id)).toEqual(antes);
      expect(await auditadas(id)).toEqual([]);
    });

    it("los dos motivos admitidos funcionan y quedan en la auditoría", async () => {
      const a = await persona();
      const b = await persona();
      valorDe(await anonimizar(a, { motivo: "PEDIDO_DEL_TITULAR" }));
      valorDe(await anonimizar(b, { motivo: "BAJA_DE_EMPRESA" }));
      expect((await auditadas(a))[0]?.["despues"]).toMatchObject({ motivo: "PEDIDO_DEL_TITULAR" });
      expect((await auditadas(b))[0]?.["despues"]).toMatchObject({ motivo: "BAJA_DE_EMPRESA" });
    });
  });

  // =============================================================================================
  describe("anonimizar", () => {
    it("vacía TODO lo personal, apaga roles y vínculos (con el cargo), conserva la fila y el id, libera el documento y la saca de la búsqueda", async () => {
      const nombre = nombreUnico("Ramón");
      const documento = { tipo: "DNI", numero: "31.222.333" };
      const id = await persona({ nombre, documento });
      const jefa = await empresa();
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: id,
          deParteId: jefa,
          tipo: "CONTACTO",
          cargo: "Encargado de compras",
        }),
      );
      const antes = await fila(id);
      expect(antes).toMatchObject({ estado: "ACTIVA", nombre, documento_numero: "31222333" });
      for (const texto of [nombre, "31222333"]) {
        const previos = valorDe(await c.consultas.buscarPartes(e.gerente, { texto }));
        expect(previos.partes.map((p) => p.id)).toContain(id);
      }

      expect(valorDe(await anonimizar(id, { conReferenciaDelPedido: true }))).toEqual({
        yaEstabaAnonimizada: false,
      });

      const despues = await fila(id);
      expect(despues).toMatchObject({
        id,
        empresa_id: e.empresa,
        estado: "ANONIMIZADA",
        naturaleza: "HUMANA",
        creado_por: antes?.["creado_por"],
      });
      for (const columna of COLUMNAS_PERSONALES) expect(despues?.[columna], columna).toBeNull();
      expect(despues?.["anonimizada_en"]).toBeInstanceOf(Date);
      expect(Number(despues?.["version"])).toBeGreaterThan(Number(antes?.["version"]));
      expect(await rolesDe(id)).toEqual([
        { rol: "CUSTOMER", activo: false },
        { rol: "PROVEEDOR", activo: false },
      ]);
      expect(await vinculosDe(id)).toEqual([
        { parte_id: id, de_parte_id: jefa, tipo: "CONTACTO", cargo: null, activo: false },
      ]);

      // El documento queda libre para otra parte de la empresa; la anonimizada no sale en la búsqueda por el nombre ni por el documento viejos.
      const otra = await persona({ documento });
      expect(otra).not.toBe(id);
      for (const texto of [nombre, "31222333"]) {
        const hallados = valorDe(
          await c.consultas.buscarPartes(e.gerente, { texto, incluirDesactivadas: true }),
        );
        expect(hallados.partes.map((p) => p.id)).not.toContain(id);
      }
      // La ficha de una anonimizada no devuelve nada personal, ni vínculos.
      expect(valorDe(await c.consultas.fichaDeParte(e.gerente, { parteId: id }))).toMatchObject({
        id,
        nombre: null,
        apellido: null,
        documento: null,
        email: null,
        telefono: null,
        domicilio: null,
        nota: null,
        activa: false,
        roles: [],
        vinculos: [],
      });
    });

    it("una parte desactivada también se anonimiza; una empresa (jurídica) también", async () => {
      const desactivada = await persona();
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: desactivada }));
      expect(valorDe(await anonimizar(desactivada))).toEqual({ yaEstabaAnonimizada: false });
      expect(await fila(desactivada)).toMatchObject({ estado: "ANONIMIZADA", nombre: null });
      expect((await auditadas(desactivada))[0]?.["antes"]).toEqual({ estado: "INACTIVA" });

      const razonSocial = await empresa();
      expect(valorDe(await anonimizar(razonSocial, { motivo: "BAJA_DE_EMPRESA" }))).toEqual({
        yaEstabaAnonimizada: false,
      });
      expect(await fila(razonSocial)).toMatchObject({
        estado: "ANONIMIZADA",
        naturaleza: "JURIDICA",
        nombre: null,
        documento_numero: null,
      });
    });

    it("una parte que es la empresa de otros vínculos los apaga también y les vacía el cargo (de ellos no queda nada personal de esa relación)", async () => {
      const jefa = await empresa();
      const contacto = await persona();
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: contacto,
          deParteId: jefa,
          tipo: "AGENTE_DE",
          cargo: "Ventas",
        }),
      );
      valorDe(await anonimizar(jefa, { motivo: "BAJA_DE_EMPRESA" }));
      expect(await vinculosDe(jefa)).toEqual([
        { parte_id: contacto, de_parte_id: jefa, tipo: "AGENTE_DE", cargo: null, activo: false },
      ]);
      // El contacto no se toca: sigue activa, con sus datos.
      expect(await fila(contacto)).toMatchObject({ estado: "ACTIVA" });
      expect((await fila(contacto))?.["nombre"]).not.toBeNull();
    });

    it("la auditoría y el aviso nombran qué pasó y quién, y NO llevan ningún dato de la parte", async () => {
      const nombre = nombreUnico("Zulema");
      const id = await persona({
        nombre,
        email: "zulema.reservada@correo.com",
        telefono: "+54 11 4777-0001",
      });
      const jefa = await empresa();
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: id,
          deParteId: jefa,
          tipo: "CONTACTO",
          cargo: "Gerente comercial",
        }),
      );
      valorDe(await anonimizar(id, { conReferenciaDelPedido: true }));

      const registros = await auditadas(id);
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_persona_id: e.gerente.personaId,
        entidad: "parte",
        entidad_id: id,
        antes: { estado: "ACTIVA" },
        despues: {
          estado: "ANONIMIZADA",
          motivo: MOTIVO,
          conReferenciaDelPedido: true,
          rolesApagados: 2,
          vinculosApagados: 1,
        },
      });
      const trabajos = await avisos(id);
      expect(trabajos).toHaveLength(1);
      expect(trabajos[0]).toMatchObject({
        empresa_id: e.empresa,
        tipo: TRABAJO_PARTE_ANONIMIZADA,
        datos: { parteId: id },
        estado: "PENDIENTE",
      });
      // Ni el nombre, ni el email, ni el teléfono, ni el documento, ni el cargo, ni la nota aparecen en lo que se guardó.
      const guardado = JSON.stringify([registros, trabajos]);
      for (const dato of [
        nombre,
        "Quiroga",
        "zulema.reservada",
        "4777-0001",
        "47770001",
        "Gerente comercial",
        "Pide factura",
        "Mitre",
      ]) {
        expect(guardado, dato).not.toContain(dato);
      }
    });

    it("sin la marca de pedido documentado, la auditoría dice que no hubo referencia", async () => {
      const id = await persona();
      valorDe(await anonimizar(id));
      expect((await auditadas(id))[0]?.["despues"]).toMatchObject({
        conReferenciaDelPedido: false,
      });
    });

    it("una parte inexistente, con un id que no es uno, o de otra empresa es PARTE_NO_ENCONTRADA (sin oráculo de existencia) y no se toca", async () => {
      const otra = await c.escenario();
      const ajena = valorDe(
        await c.casos.crearParte(otra.operador, {
          idempotencia: nuevoId(),
          naturaleza: "HUMANA",
          nombre: nombreUnico("Ajena"),
          roles: ["CUSTOMER"],
        }),
      ).parteId;
      const antes = await fila(ajena);
      for (const parteId of [ajena, randomUUID(), "no-es-un-id", ""]) {
        expect(await anonimizar(parteId)).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      }
      expect(await fila(ajena)).toEqual(antes);
      expect(await auditadas(ajena)).toEqual([]);
      // Y desde la otra empresa se puede anonimizar la suya sin afectar a la de acá.
      expect(valorDe(await anonimizar(ajena, {}, otra.gerente))).toEqual({
        yaEstabaAnonimizada: false,
      });
    });
  });

  // =============================================================================================
  describe("saldo distinto de cero impide anonimizar (decisión del dueño, 25/11/2026)", () => {
    const IMPEDIDA = {
      error: "ANONIMIZACION_IMPEDIDA",
      impedimentos: [{ modulo: "saldos_de_partes", motivo: "SALDO_DISTINTO_DE_CERO" }],
    };

    it("con saldo en contra (se le debe) queda impedida sin cambiar nada; al saldar, se puede", async () => {
      const id = await persona();
      expect((await asentar(id, "CARGO_DE_FACTURA_DE_COMPRA", "100.00")).ok).toBe(true);
      const antes = await fila(id);
      const auditoriaAntes = await totalDeAuditoria();
      expect(await anonimizar(id)).toEqual({ ok: false, error: IMPEDIDA });
      expect(await fila(id)).toEqual(antes);
      expect(await rolesDe(id)).toEqual([
        { rol: "CUSTOMER", activo: true },
        { rol: "PROVEEDOR", activo: true },
      ]);
      expect(await totalDeAuditoria()).toBe(auditoriaAntes);
      expect(await avisos(id)).toEqual([]);

      expect((await asentar(id, "PAGO_A_PROVEEDOR", "-100.00")).ok).toBe(true);
      expect(await saldoDe(id)).toBe("0.00");
      expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
      expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA" });
    });

    it("con saldo a favor (un pago de más) también queda impedida", async () => {
      const id = await persona();
      expect((await asentar(id, "PAGO_A_PROVEEDOR", "-40.00")).ok).toBe(true);
      expect(await saldoDe(id)).toBe("-40.00");
      expect(await anonimizar(id)).toEqual({ ok: false, error: IMPEDIDA });
      expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });
    });

    it("una parte desactivada con saldo también queda impedida", async () => {
      const id = await persona();
      expect((await asentar(id, "CARGO_DE_FACTURA_DE_COMPRA", "5.00")).ok).toBe(true);
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: id }));
      expect(await anonimizar(id)).toEqual({ ok: false, error: IMPEDIDA });
      expect(await fila(id)).toMatchObject({ estado: "INACTIVA" });
    });

    it("el saldo de otra parte (o de otra empresa) no impide anonimizar a ésta", async () => {
      const conSaldo = await persona();
      const sinSaldo = await persona();
      expect((await asentar(conSaldo, "CARGO_DE_FACTURA_DE_COMPRA", "77.00")).ok).toBe(true);
      expect(valorDe(await anonimizar(sinSaldo))).toEqual({ yaEstabaAnonimizada: false });
      expect(await fila(conSaldo)).toMatchObject({ estado: "ACTIVA" });
    });

    it("un saldo en un centro de costo impide aunque el total sea cero (+100 en una sucursal y −100 en otra)", async () => {
      const id = await persona();
      expect((await asentar(id, "CARGO_DE_FACTURA_DE_COMPRA", "100.00", sucursal)).ok).toBe(true);
      expect((await asentar(id, "PAGO_A_PROVEEDOR", "-100.00", sur)).ok).toBe(true);
      expect(await saldoDe(id)).toBe("0.00");
      expect(await anonimizar(id)).toEqual({ ok: false, error: IMPEDIDA });
      expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });
    });

    it("falla CERRADO: si no se puede leer el libro de saldos, no se anonimiza y no cambia nada", async () => {
      const id = await persona();
      const antes = await fila(id);
      await c.dueno.query("revoke select on saldo_de_parte from pedernal_app");
      try {
        const r = await anonimizar(id).catch((error: unknown) => ({ ok: false, error }));
        expect(r.ok).toBe(false);
      } finally {
        await c.dueno.query("grant select on saldo_de_parte to pedernal_app");
      }
      expect(await fila(id)).toEqual(antes);
      expect(await rolesDe(id)).toEqual([
        { rol: "CUSTOMER", activo: true },
        { rol: "PROVEEDOR", activo: true },
      ]);
      expect(await auditadas(id)).toEqual([]);
      expect(await avisos(id)).toEqual([]);
      // Con la lectura repuesta, la misma parte se anonimiza.
      expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
    });

    it("una parte anonimizada no admite asientos nuevos (la base lo impide)", async () => {
      const id = await persona();
      valorDe(await anonimizar(id));
      const r = await asentar(id, "CARGO_DE_FACTURA_DE_COMPRA", "1.00");
      expect(r.ok).toBe(false);
      expect(await saldoDe(id)).toBe("0");
    });
  });

  // =============================================================================================
  describe("idempotencia", () => {
    it("I1: anonimizar dos veces es ok y la segunda no escribe, no audita y no encola otro aviso", async () => {
      const id = await persona();
      expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
      const despues = await fila(id);
      const auditoria = await totalDeAuditoria();
      const encolados = await totalDeAvisos();
      expect(await auditadas(id)).toHaveLength(1);
      expect(await avisos(id)).toHaveLength(1);

      for (let i = 0; i < 3; i++) {
        expect(valorDe(await anonimizar(id, { motivo: "BAJA_DE_EMPRESA" }))).toEqual({
          yaEstabaAnonimizada: true,
        });
      }
      expect(await fila(id)).toEqual(despues);
      expect(await totalDeAuditoria()).toBe(auditoria);
      expect(await totalDeAvisos()).toBe(encolados);
      expect(await auditadas(id)).toHaveLength(1);
      expect(await avisos(id)).toHaveLength(1);
      // El motivo de la repetición no pisa el de la primera vez.
      expect((await auditadas(id))[0]?.["despues"]).toMatchObject({ motivo: MOTIVO });
    });

    it("repetir con un motivo inválido sobre una anonimizada sigue siendo un error de motivo (se valida primero)", async () => {
      const id = await persona();
      valorDe(await anonimizar(id));
      expect(await anonimizar(id, { motivo: "OTRO" })).toEqual({
        ok: false,
        error: "MOTIVO_DE_ANONIMIZACION_INVALIDO",
      });
    });

    it("el aviso a los módulos con copias se encola una sola vez por parte (clave única)", async () => {
      const id = await persona();
      valorDe(await anonimizar(id));
      valorDe(await anonimizar(id));
      expect(
        await c.contar(
          "select count(*) as n from trabajo where empresa_id = $1 and clave_idempotencia = $2",
          [e.empresa, `parte:${id}:anonimizada`],
        ),
      ).toBe(1);
    });
  });

  // =============================================================================================
  describe("concurrencia", () => {
    it("dos anonimizaciones a la vez de la misma parte: una anonimiza y la otra ve que ya estaba; un solo registro de auditoría y un solo aviso", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const id = await persona();
        const [a, b] = await Promise.all([
          anonimizar(id),
          anonimizar(id, { motivo: "BAJA_DE_EMPRESA" }),
        ]);
        expect(
          [codigoDe(a), codigoDe(b)].every((x) => x === "ok" || x === "ConcurrenciaAgotada"),
        ).toBe(true);
        const hechas = [a, b]
          .filter((r) => r.ok)
          .map((r) => (r.ok ? r.valor.yaEstabaAnonimizada : null));
        // Nunca dos que anonimizan: a lo sumo una dice `false`; si las dos salieron ok, la otra dice que ya estaba.
        expect(hechas.filter((x) => x === false)).toHaveLength(1);
        expect(hechas.filter((x) => x === true).length).toBe(hechas.length - 1);
        expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA", nombre: null });
        expect(await auditadas(id)).toHaveLength(1);
        expect(await avisos(id)).toHaveLength(1);
      }
    });

    it("anonimizar contra editar a la vez: nunca queda una anonimizada con datos ni una edición sobre una anonimizada", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const id = await persona();
        const [a, ed] = await Promise.all([
          anonimizar(id),
          c.casos.editarParte(e.operador, {
            parteId: id,
            versionEsperada: 1,
            cambios: { nota: "cambio a la vez" },
          }),
        ]);
        expect(codigoDe(a)).toBe("ok");
        const final = await fila(id);
        expect(final).toMatchObject({ estado: "ANONIMIZADA" });
        for (const columna of COLUMNAS_PERSONALES) expect(final?.[columna], columna).toBeNull();
        // La edición, si llegó antes, quedó pisada por el vaciado; si llegó después, fue rechazada: de ninguna forma deja datos.
        expect([
          "ok",
          "VERSION_DESACTUALIZADA",
          "PARTE_NO_ENCONTRADA",
          "ConcurrenciaAgotada",
        ]).toContain(codigoDe(ed));
        expect(await auditadas(id)).toHaveLength(1);
      }
    });

    it("anonimizar contra un asiento de saldo que llega a la vez: o entra el asiento y la anonimización queda impedida, o se anonimiza y el asiento falla; nunca una anonimizada con saldo", async () => {
      let impedidas = 0;
      let anonimizadas = 0;
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const id = await persona();
        const [a, asiento] = await Promise.all([
          anonimizar(id),
          asentar(id, "CARGO_DE_FACTURA_DE_COMPRA", "100.00"),
        ]);
        const final = await fila(id);
        const saldo = await saldoDe(id);
        const asientos = await c.contar(
          "select count(*) as n from asiento_de_saldo where parte_id = $1",
          [id],
        );
        if (final?.["estado"] === "ANONIMIZADA") {
          anonimizadas++;
          expect(a.ok).toBe(true);
          expect(asiento.ok).toBe(false);
          expect(Number(saldo)).toBe(0);
          expect(asientos).toBe(0);
          for (const columna of COLUMNAS_PERSONALES) expect(final[columna], columna).toBeNull();
        } else {
          impedidas++;
          expect(asiento.ok).toBe(true);
          expect(a).toMatchObject({
            ok: false,
            error: { error: "ANONIMIZACION_IMPEDIDA" },
          });
          expect(saldo).toBe("100.00");
          expect(await auditadas(id)).toEqual([]);
          expect(await avisos(id)).toEqual([]);
        }
      }
      expect(impedidas + anonimizadas).toBe(RONDAS);
    });
  });

  // =============================================================================================
  describe("atomicidad", () => {
    it("si falla el paso de copias de otro módulo no queda nada: ni datos vaciados, ni roles ni vínculos apagados, ni auditoría ni aviso; reintentar sin la falla anonimiza", async () => {
      const id = await persona();
      const jefa = await empresa();
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: id,
          deParteId: jefa,
          tipo: "CONTACTO",
          cargo: "Compras",
        }),
      );
      const antes = await fila(id);
      const falla = { tipo: "Inesperado", sqlstate: null, mensaje: "falla inyectada" } as const;
      c.pasosDeCopias.push(() => Promise.resolve(err(falla)));
      try {
        expect(await anonimizar(id)).toEqual({ ok: false, error: falla });
      } finally {
        c.pasosDeCopias.length = 0;
      }
      expect(await fila(id)).toEqual(antes);
      expect(await rolesDe(id)).toEqual([
        { rol: "CUSTOMER", activo: true },
        { rol: "PROVEEDOR", activo: true },
      ]);
      expect(await vinculosDe(id)).toEqual([
        { parte_id: id, de_parte_id: jefa, tipo: "CONTACTO", cargo: "Compras", activo: true },
      ]);
      expect(await auditadas(id)).toEqual([]);
      expect(await avisos(id)).toEqual([]);

      expect(valorDe(await anonimizar(id))).toEqual({ yaEstabaAnonimizada: false });
      expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA" });
    });

    it("el paso de copias se llama una sola vez, con la empresa, la parte y la hora del contexto; repetir el pedido no lo vuelve a llamar", async () => {
      const id = await persona();
      const llamadas: Array<[string, string, string]> = [];
      c.pasosDeCopias.push((empresaDelPaso, parteId, ahora) => {
        llamadas.push([empresaDelPaso, parteId, ahora.toISOString()]);
        return Promise.resolve(ok(null));
      });
      try {
        valorDe(await anonimizar(id));
        valorDe(await anonimizar(id));
      } finally {
        c.pasosDeCopias.length = 0;
      }
      expect(llamadas).toEqual([[e.empresa, id, e.gerente.ahora.toISOString()]]);
    });
  });

  // =============================================================================================
  describe("lo que la base exige aunque el código se olvide (0105)", () => {
    const ANONIMIZAR_COMO_DUENO = `update parte set estado = 'ANONIMIZADA', nombre = null, apellido = null, alias = null, documento_tipo = null,
      documento_pais = null, documento_numero = null, condicion_iva = null, email = null, telefono = null, dom_pais = null, dom_calle = null, dom_numero = null,
      dom_piso = null, dom_departamento = null, dom_localidad = null, dom_provincia = null, dom_codigo_postal = null, dom_texto = null, nota = null where id = $1`;

    it("no confirma una anonimización que deja el cargo de un vínculo; con el cargo vaciado sí", async () => {
      const id = await persona();
      const jefa = await empresa();
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: id,
          deParteId: jefa,
          tipo: "CONTACTO",
          cargo: "Compras",
        }),
      );
      await c.dueno.query("begin");
      await c.dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
      await c.dueno.query("update parte_vinculo set activo = false where parte_id = $1", [id]);
      await c.dueno.query(ANONIMIZAR_COMO_DUENO, [id]);
      await expect(c.dueno.query("commit")).rejects.toMatchObject({
        code: "23514",
        constraint: "parte_anonimizada_con_cargo",
      });
      expect(await fila(id)).toMatchObject({ estado: "ACTIVA" });

      await c.dueno.query("begin");
      await c.dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
      await c.dueno.query(
        "update parte_vinculo set activo = false, cargo = null where parte_id = $1",
        [id],
      );
      await c.dueno.query(ANONIMIZAR_COMO_DUENO, [id]);
      await c.dueno.query("commit");
      expect(await fila(id)).toMatchObject({ estado: "ANONIMIZADA" });
    });

    it("la acción `partes.anonimizar` nace con el piso SOLO_GERENTE: ninguna plantilla ni rol propio la puede llevar", async () => {
      expect(
        await c.filas(
          "select tipo, autor from piso_de_plataforma where accion = 'partes.anonimizar'",
        ),
      ).toEqual([{ tipo: "SOLO_GERENTE", autor: "migracion:0105" }]);
    });
  });
});
