import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { acepta, check, clave, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  AHORA,
  DESPUES,
  HUELLA,
  abrirSesion,
  claveNueva,
  cerrarSesion,
  cobrar,
  crearCaja,
  crearEscenario,
  filasDe,
  textoDe,
  type Escenario,
  type TipoDeMedio,
} from "./caja-apoyo";
import type { Intento, SesionDePrueba } from "./sesiones";

/**
 * La migración 0027, parte del cierre del día (e3b §4.3, §4.4 y §4.6; §5 «Contribución de caja»): corrección de medio, declaración de
 * totales, conforme general y la foto que caja congela al cerrar la jornada, con SQL directo y el rol de la aplicación. Cada tabla es de solo
 * inserción (también para el dueño); las correcciones y declaraciones solo valen con la jornada EN_AUDITORIA; la foto solo entra mientras la
 * jornada está en auditoría o en la transacción que la cierra, y al confirmar los diferidos la recalculan (`caja_conciliacion_*`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Linea = Readonly<{
  medio: TipoDeMedio;
  cuenta?: string | null;
  registrado: string;
  correcciones: string;
  declarado: string | null;
  estado: "CONTADO" | "DECLARADO" | "CONFORME" | "SIN_DATO";
  por?: string | null;
  en?: string | null;
  explicacion?: string | null;
}>;

describe.skipIf(base === null)("migración 0027: lo que caja aporta al cierre del día", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let esc: Escenario;
  let cajaDos: string;
  let sucursalDos: string;
  let terminalDeOtraSucursal: string;

  const b = () => propia.base;
  let contador = 0;
  const fechaNueva = () => {
    contador += 1;
    return `2027-02-${String(contador).padStart(2, "0")}`;
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    esc = await crearEscenario(dueno, m);
    cajaDos = await crearCaja(dueno, m, "Caja 2");
    sucursalDos = (
      await dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Sucursal dos') returning id",
        [m.empresa],
      )
    ).rows[0]?.id as string;
    terminalDeOtraSucursal = (
      await dueno.query<{ id: string }>(
        `insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Terminal 2', $2) returning id`,
        [m.empresa, sucursalDos],
      )
    ).rows[0]?.id as string;
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /** Billetes (voraz, de mayor a menor) que suman `total` (múltiplo de 100). */
  const billetesPara = (total: number): Record<number, number> => {
    const r: Record<number, number> = {};
    let resto = total;
    for (const d of [20000, 10000, 2000, 1000, 500, 200, 100]) {
      const n = Math.floor(resto / d);
      if (n > 0) r[d] = n;
      resto -= n * d;
    }
    return r;
  };

  type CobroDe = Readonly<{
    medio: TipoDeMedio;
    cuenta?: string | null;
    importe: string;
    origen?: { id?: string; orden?: number };
  }>;

  /**
   * Una jornada de la fecha con una sesión cerrada (fondo 1000 + los cobros), todo confirmado; y, si se pide, con la jornada EN_AUDITORIA.
   * Devuelve los ids de los cobros, en orden.
   */
  const jornadaConCobros = async (
    fecha: string,
    cobros: readonly CobroDe[],
    opciones: { caja?: string; auditar?: boolean; conforme?: boolean; fondo?: string } = {},
  ): Promise<{ sesion: string; cobros: string[] }> => {
    const ids: string[] = [];
    let sesionId = "";
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc, {
        ...(opciones.caja === undefined ? {} : { caja: opciones.caja }),
        abiertaEn: `${fecha}T15:00:00Z`,
        fondo: opciones.fondo ?? "1000.00",
      });
      sesionId = sesion;
      let efectivo = Number(opciones.fondo ?? "1000.00");
      for (const c of cobros) {
        ids.push(await cobrar(s, esc, sesion, c));
        if (c.medio === "EFECTIVO") efectivo += Number(c.importe);
      }
      await cerrarSesion(s, esc, sesion, {
        billetes: billetesPara(efectivo),
        ...(opciones.conforme === undefined ? {} : { conforme: opciones.conforme }),
      });
      const r = await s.confirmar();
      expect(r.ok, r.ok ? "" : `${r.restriccion}: ${r.mensaje}`).toBe(true);
    });
    if (opciones.auditar !== false) await auditar(fecha);
    return { sesion: sesionId, cobros: ids };
  };

  const auditar = (fecha: string) =>
    conAppDe(b(), m, async (s) => {
      acepta(
        await s.intentar(
          `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
            where empresa_id = $1 and sucursal_id = $5 and fecha_negocio = $2`,
          [m.empresa, fecha, AHORA, m.persona, m.sucursal],
        ),
      );
      const r = await s.confirmar();
      expect(r.ok).toBe(true);
    });

  const medioId = (t: TipoDeMedio) => esc.medios[t];

  // ---- correcciones de medio -----------------------------------------------------------------
  type Corregir = Partial<{
    cobro: string;
    secuencia: number;
    fecha: string;
    sucursal: string;
    antes: [TipoDeMedio, string | null];
    despues: [TipoDeMedio, string | null];
    motivo: string;
    clave: string;
    persona: string;
  }>;
  const corregir = (s: SesionDePrueba, c: Corregir & { cobro: string; fecha: string }) => {
    const antes = c.antes ?? ["TARJETA_CREDITO", esc.cuentas.terminal];
    const despues = c.despues ?? ["TARJETA_DEBITO", esc.cuentas.terminal];
    return s.intentar(
      `insert into correccion_de_medio (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, cuenta_antes_id,
                                       medio_despues_id, cuenta_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [
        m.empresa,
        c.cobro,
        c.secuencia ?? 1,
        c.sucursal ?? m.sucursal,
        c.fecha,
        medioId(antes[0]),
        antes[1],
        medioId(despues[0]),
        despues[1],
        c.motivo ?? "Se cargó con otro medio",
        AHORA,
        c.persona ?? m.persona,
        c.clave ?? claveNueva(),
        HUELLA,
      ],
    );
  };

  describe("corrección de medio de un cobro", () => {
    it("de cualquier medio a cualquier otro, con secuencia sin huecos; ida y vuelta (A → B → A) deja el cobro en su medio original", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "18400.00" },
      ]);
      const cobro = cobros[0] as string;
      await conAppDe(b(), m, async (s) => {
        acepta(await corregir(s, { cobro, fecha, secuencia: 1 }));
        // Efectivo (sin cuenta), transferencia, QR con y sin cuenta.
        acepta(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 2,
            antes: ["TARJETA_DEBITO", esc.cuentas.terminal],
            despues: ["EFECTIVO", null],
          }),
        );
        acepta(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 3,
            antes: ["EFECTIVO", null],
            despues: ["TRANSFERENCIA", esc.cuentas.banco],
          }),
        );
        acepta(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 4,
            antes: ["TRANSFERENCIA", esc.cuentas.banco],
            despues: ["QR", null],
          }),
        );
        acepta(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 5,
            antes: ["QR", null],
            despues: ["QR", esc.cuentas.qr],
          }),
        );
        // Ida y vuelta: de nuevo al original.
        acepta(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 6,
            antes: ["QR", esc.cuentas.qr],
            despues: ["TARJETA_CREDITO", esc.cuentas.terminal],
          }),
        );
        const rows = filasDe(
          await s.intentar(
            "select count(*)::int as n from correccion_de_medio where cobro_id = $1",
            [cobro],
          ),
        );
        expect(rows[0]?.["n"]).toBe(6);
      });
    });

    it("«antes» es el medio vigente y la secuencia sigue sin huecos", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      const cobro = cobros[0] as string;
      await conAppDe(b(), m, async (s) => {
        // La secuencia empieza en 1; «antes» tiene que ser el original (crédito con terminal).
        check(
          await corregir(s, { cobro, fecha, secuencia: 2 }),
          "correccion_de_medio_secuencia_invalida",
        );
        check(
          await corregir(s, { cobro, fecha, secuencia: 0 }),
          "correccion_de_medio_secuencia_invalida",
        );
        check(
          await corregir(s, {
            cobro,
            fecha,
            antes: ["TARJETA_DEBITO", esc.cuentas.terminal],
            despues: ["EFECTIVO", null],
          }),
          "correccion_de_medio_antes_no_vigente",
        );
        check(
          await corregir(s, { cobro, fecha, antes: ["TARJETA_CREDITO", null] }),
          "correccion_de_medio_antes_no_vigente",
        );
        acepta(await corregir(s, { cobro, fecha, secuencia: 1 }));
        // Ahora el vigente es débito: corregir otra vez desde el original ya no sirve.
        check(
          await corregir(s, { cobro, fecha, secuencia: 2 }),
          "correccion_de_medio_antes_no_vigente",
        );
        check(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 4,
            antes: ["TARJETA_DEBITO", esc.cuentas.terminal],
            despues: ["EFECTIVO", null],
          }),
          "correccion_de_medio_secuencia_invalida",
        );
      });
    });

    it("el mismo par antes y después no es una corrección", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      await conAppDe(b(), m, async (s) => {
        check(
          await corregir(s, {
            cobro: cobros[0] as string,
            fecha,
            antes: ["TARJETA_CREDITO", esc.cuentas.terminal],
            despues: ["TARJETA_CREDITO", esc.cuentas.terminal],
          }),
          "correccion_de_medio_cambia_ck",
        );
      });
    });

    it("solo con la jornada EN_AUDITORIA: ABIERTA o CERRADA no admiten correcciones", async () => {
      const abierta = fechaNueva();
      const cerrada = fechaNueva();
      const { cobros: deAbierta } = await jornadaConCobros(
        abierta,
        [{ medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" }],
        { auditar: false },
      );
      const { cobros: deCerrada } = await jornadaConCobros(cerrada, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      await conAppDe(b(), m, async (s) => {
        acepta(
          await s.intentar(
            `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $3, cerrada_por = $4, huella_de_cierre = $5
              where empresa_id = $1 and sucursal_id = $6 and fecha_negocio = $2`,
            [m.empresa, cerrada, DESPUES, m.persona, HUELLA, m.sucursal],
          ),
        );
        await s.confirmar();
      });
      await conAppDe(b(), m, async (s) => {
        check(
          await corregir(s, { cobro: deAbierta[0] as string, fecha: abierta }),
          "correccion_de_medio_jornada_no_en_auditoria",
        );
        check(
          await corregir(s, { cobro: deCerrada[0] as string, fecha: cerrada }),
          "correccion_de_medio_jornada_no_en_auditoria",
        );
      });
    });

    it("el destino tiene que estar activo, ser compatible y de la sucursal; el efectivo no lleva cuenta", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      const cobro = cobros[0] as string;
      await conAppDe(b(), m, async (s) => {
        check(
          await corregir(s, { cobro, fecha, despues: ["EFECTIVO", esc.cuentas.terminal] }),
          "correccion_de_medio_cuenta_no_admitida",
        );
        check(
          await corregir(s, { cobro, fecha, despues: ["TRANSFERENCIA", esc.cuentas.terminal] }),
          "correccion_de_medio_cuenta_incompatible",
        );
        check(
          await corregir(s, { cobro, fecha, despues: ["TARJETA_DEBITO", terminalDeOtraSucursal] }),
          "correccion_de_medio_cuenta_de_otra_sucursal",
        );
        acepta(
          await s.intentar("update cuenta_de_cobro set activa = false where id = $1", [
            esc.cuentas.qr,
          ]),
        );
        check(
          await corregir(s, { cobro, fecha, despues: ["QR", esc.cuentas.qr] }),
          "correccion_de_medio_cuenta_inactiva",
        );
        acepta(
          await s.intentar("update medio_de_pago set activo = false where id = $1", [
            esc.medios.OTRO,
          ]),
        );
        check(
          await corregir(s, { cobro, fecha, despues: ["OTRO", null] }),
          "correccion_de_medio_medio_inactivo",
        );
      });
    });

    it("con motivo (lista de permitidos), por la persona del contexto, de un cobro y con la sucursal y fecha de su sesión", async () => {
      const fecha = fechaNueva();
      const { cobros, sesion } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      const cobro = cobros[0] as string;
      await conAppDe(b(), m, async (s) => {
        for (const motivo of ["", " ", "con\nsalto", "con <b>", " con borde", "x".repeat(501)]) {
          const r = await corregir(s, { cobro, fecha, motivo });
          expect(r.ok, motivo).toBe(false);
          expect(!r.ok && r.restriccion).toBe("correccion_de_medio_motivo_ck");
        }
        check(
          await corregir(s, { cobro, fecha, persona: "00000000-0000-4000-8000-000000000000" }),
          "correccion_de_medio_actor_invalido",
        );
        // Un ingreso no es un cobro.
        const fondo = textoDe(
          await s.intentar(
            "select id from movimiento_caja where sesion_id = $1 and clase = 'FONDO_INICIAL'",
            [sesion],
          ),
          "id",
        );
        check(await corregir(s, { cobro: fondo, fecha }), "correccion_de_medio_cobro_invalido");
        // La fecha o la sucursal no son las de la sesión del cobro.
        check(
          await corregir(s, { cobro, fecha: "2027-03-30" }),
          "correccion_de_medio_jornada_invalida",
        );
        check(
          await corregir(s, { cobro, fecha, sucursal: sucursalDos }),
          "correccion_de_medio_jornada_invalida",
        );
        acepta(await corregir(s, { cobro, fecha, motivo: "x".repeat(500) }));
      });
    });

    it("la clave de idempotencia es única por empresa", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "200.00" },
      ]);
      await conAppDe(b(), m, async (s) => {
        const una = claveNueva();
        acepta(await corregir(s, { cobro: cobros[0] as string, fecha, clave: una }));
        clave(
          await corregir(s, { cobro: cobros[1] as string, fecha, clave: una }),
          "correccion_de_medio_clave_uk",
        );
      });
    });
  });

  // ---- declaración de totales y conforme general -----------------------------------------------
  const declarar = (
    s: SesionDePrueba,
    d: {
      fecha: string;
      medio: TipoDeMedio;
      cuenta?: string | null;
      secuencia?: number;
      importe?: string;
      persona?: string;
      sucursal?: string;
    },
  ) =>
    s.intentar(
      `insert into declaracion_de_total (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, secuencia, importe,
                                        declarado_en, declarado_por, clave_idempotencia, huella)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        m.empresa,
        d.sucursal ?? m.sucursal,
        d.fecha,
        medioId(d.medio),
        d.cuenta ?? null,
        d.secuencia ?? 1,
        d.importe ?? "100.00",
        AHORA,
        d.persona ?? m.persona,
        claveNueva(),
        HUELLA,
      ],
    );

  describe("declaración de totales", () => {
    it("declara por medio y cuenta (con o sin cuenta); otra declaración del mismo par es una fila nueva; el efectivo no se declara", async () => {
      const fecha = fechaNueva();
      await jornadaConCobros(fecha, []);
      await conAppDe(b(), m, async (s) => {
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "300.00",
          }),
        );
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            secuencia: 2,
            importe: "310.00",
          }),
        );
        acepta(await declarar(s, { fecha, medio: "QR", importe: "0.00" })); // «sin cuenta»
        acepta(await declarar(s, { fecha, medio: "QR", secuencia: 2, importe: "5.00" }));
        check(
          await declarar(s, { fecha, medio: "EFECTIVO" }),
          "declaracion_de_total_medio_no_declarable",
        );
        // La secuencia sigue sin huecos y no repite.
        check(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            secuencia: 2,
          }),
          "declaracion_de_total_secuencia_invalida",
        );
        check(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            secuencia: 4,
          }),
          "declaracion_de_total_secuencia_invalida",
        );
        check(
          await declarar(s, { fecha, medio: "QR", secuencia: 1 }),
          "declaracion_de_total_secuencia_invalida",
        );
      });
    });

    it("solo con la jornada EN_AUDITORIA, por la persona del contexto, con importes válidos y cuentas compatibles y de la sucursal", async () => {
      const abierta = fechaNueva();
      await jornadaConCobros(abierta, [], { auditar: false });
      const fecha = fechaNueva();
      await jornadaConCobros(fecha, []);
      await conAppDe(b(), m, async (s) => {
        check(
          await declarar(s, { fecha: abierta, medio: "QR" }),
          "declaracion_de_total_jornada_no_en_auditoria",
        );
        check(
          await declarar(s, {
            fecha,
            medio: "QR",
            persona: "00000000-0000-4000-8000-000000000000",
          }),
          "declaracion_de_total_actor_invalido",
        );
        check(
          await declarar(s, { fecha, medio: "QR", importe: "-1.00" }),
          "declaracion_de_total_importe_ck",
        );
        check(
          await declarar(s, { fecha, medio: "QR", importe: "1000000000.00" }),
          "declaracion_de_total_importe_ck",
        );
        check(
          await declarar(s, { fecha, medio: "TARJETA_DEBITO", cuenta: esc.cuentas.banco }),
          "declaracion_de_total_cuenta_incompatible",
        );
        check(
          await declarar(s, { fecha, medio: "TARJETA_DEBITO", cuenta: terminalDeOtraSucursal }),
          "declaracion_de_total_cuenta_de_otra_sucursal",
        );
        check(
          await declarar(s, { fecha, medio: "EFECTIVO", cuenta: esc.cuentas.terminal }),
          "declaracion_de_total_cuenta_no_admitida",
        );
        acepta(
          await declarar(s, {
            fecha,
            medio: "QR",
            cuenta: esc.cuentas.terminal,
            importe: "999999999.99",
          }),
        );
      });
    });
  });

  describe("conforme general", () => {
    const conforme = (s: SesionDePrueba, fecha: string, persona: string = m.persona) =>
      s.intentar(
        `insert into conforme_de_jornada (empresa_id, sucursal_id, fecha_negocio, conforme_por, conforme_en, clave_idempotencia, huella)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [m.empresa, m.sucursal, fecha, persona, AHORA, claveNueva(), HUELLA],
      );

    it("una sola por jornada (repetirlo es idempotente en el caso de uso), solo en auditoría, y sobrevive a cancelar la auditoría", async () => {
      const fecha = fechaNueva();
      await jornadaConCobros(fecha, []);
      await conAppDe(b(), m, async (s) => {
        check(
          await conforme(s, fecha, "00000000-0000-4000-8000-000000000000"),
          "conforme_de_jornada_actor_invalido",
        );
        acepta(await conforme(s, fecha));
        clave(await conforme(s, fecha), "conforme_de_jornada_pkey");
        await s.confirmar();
      });
      await conAppDe(b(), m, async (s) => {
        acepta(
          await s.intentar(
            `update jornada_de_sucursal set estado = 'ABIERTA', auditoria_iniciada_en = null, auditoria_iniciada_por = null
              where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
            [m.empresa, m.sucursal, fecha],
          ),
        );
        // Con la jornada ABIERTA ya no se da otro conforme (ni el mismo: la fila existe y la jornada ya no está en auditoría).
        const otraFecha = fechaNueva();
        await s.intentar(
          "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
          [m.empresa, m.sucursal, otraFecha],
        );
        check(await conforme(s, otraFecha), "conforme_de_jornada_jornada_no_en_auditoria");
        await s.confirmar();
      });
      const { rows } = await dueno.query<{ n: string }>(
        "select count(*)::text as n from conforme_de_jornada where empresa_id = $1 and fecha_negocio = $2",
        [m.empresa, fecha],
      );
      expect(rows[0]?.n).toBe("1");
    });
  });

  // ---- la foto que caja congela al cerrar la jornada -------------------------------------------
  const cabecera = (s: SesionDePrueba, fecha: string, persona: string = m.persona) =>
    s.directo(
      `insert into cierre_de_caja_de_jornada (empresa_id, sucursal_id, fecha_negocio, congelado_en, congelado_por) values ($1, $2, $3, $4, $5)`,
      [m.empresa, m.sucursal, fecha, AHORA, persona],
    );
  const lineaDe = (s: SesionDePrueba, fecha: string, l: Linea) =>
    s.intentar(
      `insert into conciliacion_de_jornada (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, registrado,
                                            correcciones, declarado, estado_de_conteo, conforme_por, conforme_en, explicacion)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        m.empresa,
        m.sucursal,
        fecha,
        medioId(l.medio),
        l.cuenta ?? null,
        l.registrado,
        l.correcciones,
        l.declarado,
        l.estado,
        l.por ?? null,
        l.en ?? null,
        l.explicacion ?? null,
      ],
    );
  const porOrigen = (
    s: SesionDePrueba,
    fecha: string,
    o: {
      origen: string;
      ticket?: string;
      cobrado: string;
      total: string;
      explicacion?: string | null;
    },
  ) =>
    s.intentar(
      `insert into conciliacion_de_cobro_por_origen (empresa_id, sucursal_id, fecha_negocio, origen_tipo, origen_id, ticket_id, cobrado,
                                                     total_del_ticket, explicacion)
       values ($1, $2, $3, 'ventas.cobranza_de_ticket', $4, $5, $6, $7, $8)`,
      [
        m.empresa,
        m.sucursal,
        fecha,
        o.origen,
        o.ticket ?? randomUUID(),
        o.cobrado,
        o.total,
        o.explicacion ?? null,
      ],
    );
  const cerrarLaJornada = (s: SesionDePrueba, fecha: string) =>
    s.directo(
      `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $3, cerrada_por = $4, huella_de_cierre = $5
        where empresa_id = $1 and sucursal_id = $6 and fecha_negocio = $2`,
      [m.empresa, fecha, DESPUES, m.persona, HUELLA, m.sucursal],
    );

  /** Cabecera, líneas, orígenes y cierre de la jornada, en una transacción; devuelve el resultado de confirmar (o el primer error). */
  const congelar = async (
    s: SesionDePrueba,
    fecha: string,
    lineas: readonly Linea[],
    opciones: {
      origenes?: readonly { origen: string; cobrado: string; total: string }[];
      cerrar?: boolean;
      persona?: string;
    } = {},
  ): Promise<Intento> => {
    const c = await cabecera(s, fecha, opciones.persona);
    if (!c.ok) return c;
    for (const l of lineas) {
      const r = await lineaDe(s, fecha, l);
      if (!r.ok) return r;
    }
    for (const o of opciones.origenes ?? []) {
      const r = await porOrigen(s, fecha, o);
      if (!r.ok) return r;
    }
    if (opciones.cerrar !== false) {
      const r = await cerrarLaJornada(s, fecha);
      if (!r.ok) return r;
    }
    return s.confirmar();
  };
  const rechazo = (r: Intento): string | undefined => (r.ok ? undefined : r.restriccion);

  describe("la foto de caja al cerrar la jornada (crédito → débito, con declaraciones)", () => {
    const fecha = "2027-04-01";
    const ORIGEN = "00000000-0000-4000-8000-0000000000aa";
    let lineasOk: readonly Linea[];

    beforeAll(async () => {
      // Efectivo: fondo 1000 + cobro 500 = 1500. Un cobro de 18.400 cargado con crédito que era débito (corregido).
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "EFECTIVO", importe: "500.00" },
        {
          medio: "TARJETA_CREDITO",
          cuenta: esc.cuentas.terminal,
          importe: "18400.00",
          origen: { id: ORIGEN },
        },
      ]);
      await conAppDe(b(), m, async (s) => {
        acepta(await corregir(s, { cobro: cobros[1] as string, fecha }));
        // Las terminales dicen la verdad: crédito 0 y débito 18.400 (e3b §4.4, «ejemplo crédito → débito»).
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_CREDITO",
            cuenta: esc.cuentas.terminal,
            importe: "0.00",
          }),
        );
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "18400.00",
          }),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      lineasOk = [
        {
          medio: "EFECTIVO",
          registrado: "1500.00",
          correcciones: "0.00",
          declarado: "1500.00",
          estado: "CONTADO",
        },
        {
          medio: "TARJETA_CREDITO",
          cuenta: esc.cuentas.terminal,
          registrado: "18400.00",
          correcciones: "-18400.00",
          declarado: "0.00",
          estado: "DECLARADO",
        },
        {
          medio: "TARJETA_DEBITO",
          cuenta: esc.cuentas.terminal,
          registrado: "0.00",
          correcciones: "18400.00",
          declarado: "18400.00",
          estado: "DECLARADO",
        },
      ];
    });

    const conLineas = (cambio: (ls: Linea[]) => Linea[]) => cambio([...lineasOk]);

    it("una cabecera sin líneas, con una línea de menos o de más se rechaza al confirmar (caja_conciliacion_incompleta)", async () => {
      await conAppDe(b(), m, async (s) => {
        expect(rechazo(await congelar(s, fecha, []))).toBe("caja_conciliacion_incompleta");
      });
      await conAppDe(b(), m, async (s) => {
        expect(rechazo(await congelar(s, fecha, lineasOk.slice(0, 2)))).toBe(
          "caja_conciliacion_incompleta",
        );
      });
      await conAppDe(b(), m, async (s) => {
        const extra: Linea = {
          medio: "QR",
          registrado: "0.00",
          correcciones: "0.00",
          declarado: null,
          estado: "SIN_DATO",
        };
        expect(rechazo(await congelar(s, fecha, [...lineasOk, extra]))).toBe(
          "caja_conciliacion_incompleta",
        );
      });
    });

    it("sumas falsas se rechazan (caja_conciliacion_no_cuadra): registrado, correcciones, declarado, estado o conforme", async () => {
      const casos: [string, Linea[]][] = [
        [
          "registrado de menos",
          conLineas((ls) => [{ ...(ls[0] as Linea), registrado: "1400.00" }, ...ls.slice(1)]),
        ],
        [
          "sin las correcciones",
          conLineas((ls) => [
            ls[0] as Linea,
            { ...(ls[1] as Linea), correcciones: "0.00" },
            ls[2] as Linea,
          ]),
        ],
        [
          "declarado distinto",
          conLineas((ls) => [...ls.slice(0, 2), { ...(ls[2] as Linea), declarado: "18000.00" }]),
        ],
        [
          "conforme sin que lo haya dado nadie",
          conLineas((ls) => [
            ls[0] as Linea,
            {
              ...(ls[1] as Linea),
              declarado: null,
              estado: "CONFORME",
              por: m.persona,
              en: DESPUES,
            },
            ls[2] as Linea,
          ]),
        ],
        [
          "sin dato aunque hay declaración",
          conLineas((ls) => [
            ls[0] as Linea,
            { ...(ls[1] as Linea), declarado: null, estado: "SIN_DATO" },
            ls[2] as Linea,
          ]),
        ],
      ];
      for (const [nombre, lineas] of casos) {
        await conAppDe(b(), m, async (s) => {
          expect(rechazo(await congelar(s, fecha, lineas)), nombre).toBe(
            "caja_conciliacion_no_cuadra",
          );
        });
      }
    });

    it("el cobrado por origen es la suma real de los cobros del origen", async () => {
      await conAppDe(b(), m, async (s) => {
        const r = await congelar(s, fecha, lineasOk, {
          origenes: [{ origen: ORIGEN, cobrado: "18000.00", total: "15000.00" }],
        });
        expect(rechazo(r)).toBe("caja_conciliacion_no_cuadra");
      });
      await conAppDe(b(), m, async (s) => {
        // Un origen que no tuvo cobros en la jornada: el cobrado real es 0.
        const r = await congelar(s, fecha, lineasOk, {
          origenes: [{ origen: randomUUID(), cobrado: "10.00", total: "5.00" }],
        });
        expect(rechazo(r)).toBe("caja_conciliacion_no_cuadra");
      });
    });

    it("el efectivo es siempre CONTADO y los demás medios nunca; las líneas respetan sus CHECK", async () => {
      await conAppDe(b(), m, async (s) => {
        expect(await cabecera(s, fecha)).toMatchObject({ ok: true });
        check(
          await lineaDe(s, fecha, { ...(lineasOk[0] as Linea), estado: "DECLARADO" }),
          "conciliacion_de_jornada_conteo_invalido",
        );
        check(
          await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), estado: "CONTADO" }),
          "conciliacion_de_jornada_conteo_invalido",
        );
        check(
          await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), declarado: null }),
          "conciliacion_de_jornada_datos_ck",
        );
        check(
          await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), declarado: "-1.00" }),
          "conciliacion_de_jornada_datos_ck",
        );
        check(
          await lineaDe(s, fecha, {
            ...(lineasOk[1] as Linea),
            estado: "CONFORME",
            declarado: "0.00",
            por: m.persona,
            en: DESPUES,
          }),
          "conciliacion_de_jornada_datos_ck",
        );
        check(
          await lineaDe(s, fecha, {
            ...(lineasOk[1] as Linea),
            estado: "CONFORME",
            declarado: null,
          }),
          "conciliacion_de_jornada_datos_ck",
        );
        check(
          await lineaDe(s, fecha, {
            ...(lineasOk[1] as Linea),
            estado: "SIN_DATO",
            declarado: "1.00",
          }),
          "conciliacion_de_jornada_datos_ck",
        );
        expect(
          (await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), estado: "OTRO" as never })).ok,
        ).toBe(false);
        check(
          await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), explicacion: "con <b>" }),
          "conciliacion_de_jornada_explicacion_ck",
        );
        check(
          await lineaDe(s, fecha, { ...(lineasOk[1] as Linea), explicacion: "x".repeat(501) }),
          "conciliacion_de_jornada_explicacion_ck",
        );
        check(
          await porOrigen(s, fecha, { origen: ORIGEN, cobrado: "10.00", total: "10.00" }),
          "conciliacion_de_cobro_difiere_ck",
        );
        check(
          await porOrigen(s, fecha, {
            origen: ORIGEN,
            cobrado: "10.00",
            total: "5.00",
            explicacion: "con\nsalto",
          }),
          "conciliacion_de_cobro_explicacion_ck",
        );
        check(
          await porOrigen(s, fecha, { origen: ORIGEN, cobrado: "10.00", total: "-5.00" }),
          "conciliacion_de_cobro_total_ck",
        );
      });
    });

    it("la cabecera la congela la persona del contexto, con la jornada en auditoría o cerrándose; sin cabecera no hay líneas", async () => {
      await conAppDe(b(), m, async (s) => {
        check(
          await cabecera(s, fecha, "00000000-0000-4000-8000-000000000000"),
          "cierre_de_caja_actor_invalido",
        );
      });
      await conAppDe(b(), m, async (s) => {
        // Sin la cabecera de esta transacción el disparador lo frena antes que la clave foránea.
        check(await lineaDe(s, fecha, lineasOk[0] as Linea), "cierre_de_caja_solo_al_cerrar");
      });
      // Una jornada ABIERTA (ni en auditoría ni cerrándose en esta transacción) no recibe la foto.
      const abierta = fechaNueva();
      await jornadaConCobros(abierta, [], { auditar: false });
      await conAppDe(b(), m, async (s) => {
        check(await cabecera(s, abierta), "cierre_de_caja_solo_al_cerrar");
      });
    });

    it("la foto sin cerrar la jornada en la misma transacción no se confirma (cierre_de_caja_solo_al_cerrar)", async () => {
      await conAppDe(b(), m, async (s) => {
        expect(rechazo(await congelar(s, fecha, lineasOk, { cerrar: false }))).toBe(
          "cierre_de_caja_solo_al_cerrar",
        );
      });
    });

    it("con todo en orden se confirma: la jornada queda CERRADA con su foto, y después nada entra ni cambia, tampoco para el dueño", async () => {
      await conAppDe(b(), m, async (s) => {
        const r = await congelar(s, fecha, lineasOk, {
          origenes: [{ origen: ORIGEN, cobrado: "18400.00", total: "15000.00" }],
        });
        expect(r.ok, r.ok ? "" : `${r.restriccion}: ${r.mensaje}`).toBe(true);
      });
      const guardadas = await dueno.query<{ estado_de_conteo: string; diferencia: string | null }>(
        `select estado_de_conteo, diferencia::text as diferencia from conciliacion_de_jornada
          where empresa_id = $1 and fecha_negocio = $2 order by registrado desc`,
        [m.empresa, fecha],
      );
      // Efectivo CONTADO (1500 − 1500 = 0); crédito 0 − (18400 − 18400) = 0; débito 18400 − (0 + 18400) = 0: las dos diferencias dan 0.
      expect(guardadas.rows).toEqual([
        { estado_de_conteo: "DECLARADO", diferencia: "0.00" },
        { estado_de_conteo: "CONTADO", diferencia: "0.00" },
        { estado_de_conteo: "DECLARADO", diferencia: "0.00" },
      ]);
      const origen = await dueno.query<{ diferencia: string }>(
        "select diferencia::text as diferencia from conciliacion_de_cobro_por_origen where empresa_id = $1 and fecha_negocio = $2",
        [m.empresa, fecha],
      );
      expect(origen.rows).toEqual([{ diferencia: "3400.00" }]);

      // Después del cierre: ni líneas nuevas (la cabecera es de otra transacción) ni correcciones ni declaraciones ni conforme.
      await conAppDe(b(), m, async (s) => {
        check(
          await lineaDe(s, fecha, {
            medio: "QR",
            registrado: "0.00",
            correcciones: "0.00",
            declarado: null,
            estado: "SIN_DATO",
          }),
          "cierre_de_caja_solo_al_cerrar",
        );
        check(
          await porOrigen(s, fecha, { origen: randomUUID(), cobrado: "1.00", total: "2.00" }),
          "cierre_de_caja_solo_al_cerrar",
        );
        check(
          await declarar(s, { fecha, medio: "QR", importe: "1.00" }),
          "declaracion_de_total_jornada_no_en_auditoria",
        );
        const cobro = textoDe(
          await s.intentar(
            "select movimiento_id as id from cobro where empresa_id = $1 and origen_id = $2",
            [m.empresa, ORIGEN],
          ),
          "id",
        );
        check(
          await corregir(s, {
            cobro,
            fecha,
            secuencia: 2,
            antes: ["TARJETA_DEBITO", esc.cuentas.terminal],
            despues: ["EFECTIVO", null],
          }),
          "correccion_de_medio_jornada_no_en_auditoria",
        );
      });

      // Todas las tablas de la contribución son de solo inserción, también para el dueño de la base.
      await dueno.query("begin");
      try {
        for (const tabla of [
          "correccion_de_medio",
          "declaracion_de_total",
          "conforme_de_jornada",
          "cierre_de_caja_de_jornada",
          "conciliacion_de_jornada",
          "conciliacion_de_cobro_por_origen",
        ]) {
          for (const sentencia of [
            `update ${tabla} set creado_en = now()`,
            `delete from ${tabla}`,
            `truncate ${tabla}`,
          ]) {
            await dueno.query("savepoint s");
            const e = await dueno.query(sentencia).then(
              () => null,
              (x: { code?: string }) => x,
            );
            await dueno.query("rollback to savepoint s");
            // `truncate` de una tabla referenciada ya lo frena Postgres (0A000); el disparador es la segunda barrera.
            expect(["42501", "0A000"], sentencia).toContain(e?.code);
          }
        }
      } finally {
        await dueno.query("rollback");
      }
      await conAppDe(b(), m, async (s) => {
        for (const tabla of [
          "correccion_de_medio",
          "declaracion_de_total",
          "conforme_de_jornada",
          "cierre_de_caja_de_jornada",
          "conciliacion_de_jornada",
          "conciliacion_de_cobro_por_origen",
        ]) {
          const r = await s.intentar(`update ${tabla} set creado_en = now()`);
          expect(!r.ok && r.codigo, tabla).toBe("42501");
          const d = await s.intentar(`delete from ${tabla}`);
          expect(!d.ok && d.codigo, tabla).toBe("42501");
        }
      });
    });
  });

  describe("el estado del conteo sale, en este orden, de la declaración, el conforme general y los cierres de caja", () => {
    const debito = (importe: string): CobroDe => ({
      medio: "TARJETA_DEBITO",
      cuenta: esc.cuentas.terminal,
      importe,
    });
    const efectivo = (registrado: string): Linea => ({
      medio: "EFECTIVO",
      registrado,
      correcciones: "0.00",
      declarado: registrado,
      estado: "CONTADO",
    });
    const unaVez = async (
      fecha: string,
      lineas: readonly Linea[],
      ok: boolean,
      esperado?: string,
    ) =>
      conAppDe(b(), m, async (s) => {
        const r = await congelar(s, fecha, lineas);
        if (ok) expect(r.ok, r.ok ? "" : `${r.restriccion}: ${r.mensaje}`).toBe(true);
        else expect(rechazo(r)).toBe(esperado);
      });

    it("sin declaración ni conforme general: lo que se contó al cerrar cada caja (DECLARADO) y su diferencia", async () => {
      const fecha = fechaNueva();
      await jornadaConCobros(fecha, [debito("300.00")]);
      const linea: Linea = {
        medio: "TARJETA_DEBITO",
        cuenta: esc.cuentas.terminal,
        registrado: "300.00",
        correcciones: "0.00",
        declarado: "300.00",
        estado: "DECLARADO",
      };
      await unaVez(
        fecha,
        [efectivo("1000.00"), { ...linea, declarado: "299.00" }],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(
        fecha,
        [efectivo("1000.00"), { ...linea, declarado: null, estado: "SIN_DATO" }],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(fecha, [efectivo("1000.00"), linea], true);
    });

    it("una declaración del par gana sobre el conforme general y sobre los cierres", async () => {
      const fecha = fechaNueva();
      await jornadaConCobros(fecha, [debito("300.00")]);
      await conAppDe(b(), m, async (s) => {
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "250.00",
          }),
        );
        acepta(
          await declarar(s, {
            fecha,
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            secuencia: 2,
            importe: "280.00",
          }),
        );
        acepta(
          await s.intentar(
            `insert into conforme_de_jornada (empresa_id, sucursal_id, fecha_negocio, conforme_por, conforme_en, clave_idempotencia, huella)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [m.empresa, m.sucursal, fecha, m.persona, AHORA, claveNueva(), HUELLA],
          ),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      const linea: Linea = {
        medio: "TARJETA_DEBITO",
        cuenta: esc.cuentas.terminal,
        registrado: "300.00",
        correcciones: "0.00",
        declarado: "280.00", // la vigente es la de mayor secuencia
        estado: "DECLARADO",
      };
      await unaVez(
        fecha,
        [efectivo("1000.00"), { ...linea, declarado: "250.00" }],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(
        fecha,
        [
          efectivo("1000.00"),
          { ...linea, declarado: null, estado: "CONFORME", por: m.persona, en: AHORA },
        ],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(fecha, [efectivo("1000.00"), linea], true);
    });

    it("con conforme general (y sin declaración): CONFORME con quién y cuándo, sin importe ni diferencia, aunque haya correcciones", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [debito("300.00")]);
      await conAppDe(b(), m, async (s) => {
        acepta(
          await corregir(s, {
            cobro: cobros[0] as string,
            fecha,
            antes: ["TARJETA_DEBITO", esc.cuentas.terminal],
            despues: ["QR", null],
          }),
        );
        acepta(
          await s.intentar(
            `insert into conforme_de_jornada (empresa_id, sucursal_id, fecha_negocio, conforme_por, conforme_en, clave_idempotencia, huella)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [m.empresa, m.sucursal, fecha, m.persona, AHORA, claveNueva(), HUELLA],
          ),
        );
        expect((await s.confirmar()).ok).toBe(true);
      });
      const conformes = (
        registrado: string,
        correcciones: string,
        medio: TipoDeMedio,
        cuenta: string | null,
      ): Linea => ({
        medio,
        cuenta,
        registrado,
        correcciones,
        declarado: null,
        estado: "CONFORME",
        por: m.persona,
        en: AHORA,
      });
      const debitoConforme = conformes("300.00", "-300.00", "TARJETA_DEBITO", esc.cuentas.terminal);
      const qrConforme = conformes("0.00", "300.00", "QR", null);
      // Quien da el conforme es quien lo dio, y cuándo.
      await unaVez(
        fecha,
        [efectivo("1000.00"), { ...debitoConforme, en: DESPUES }, qrConforme],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(
        fecha,
        [
          efectivo("1000.00"),
          { ...debitoConforme, declarado: "300.00", estado: "DECLARADO", por: null, en: null },
          qrConforme,
        ],
        false,
        "caja_conciliacion_no_cuadra",
      );
      // Con los dos pares CONFORME, la línea no tiene diferencia («conforme») aunque el par tenga correcciones.
      await unaVez(fecha, [efectivo("1000.00"), debitoConforme, qrConforme], true);
    });

    it("sin acto del día: todas las sesiones conformes → CONFORME (con el último); una mezcla de contadas y conformes → SIN_DATO", async () => {
      const fechaConforme = fechaNueva();
      await jornadaConCobros(fechaConforme, [debito("300.00")], { conforme: true });
      const conforme: Linea = {
        medio: "TARJETA_DEBITO",
        cuenta: esc.cuentas.terminal,
        registrado: "300.00",
        correcciones: "0.00",
        declarado: null,
        estado: "CONFORME",
        por: m.persona,
        en: `${fechaConforme}T19:00:00Z`, // el instante del cierre de la caja (cuatro horas después de abrir)
      };
      await unaVez(fechaConforme, [efectivo("1000.00"), conforme], true);

      // Dos cajas de la misma jornada: una cuenta el débito y la otra da el conforme.
      const fechaMezcla = fechaNueva();
      await jornadaConCobros(fechaMezcla, [debito("100.00")], { auditar: false });
      await jornadaConCobros(fechaMezcla, [debito("50.00")], {
        auditar: false,
        caja: cajaDos,
        conforme: true,
      });
      await auditar(fechaMezcla);
      const mezcla: Linea = {
        medio: "TARJETA_DEBITO",
        cuenta: esc.cuentas.terminal,
        registrado: "150.00",
        correcciones: "0.00",
        declarado: null,
        estado: "SIN_DATO",
      };
      await unaVez(
        fechaMezcla,
        [efectivo("2000.00"), { ...mezcla, declarado: "100.00", estado: "DECLARADO" }],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(
        fechaMezcla,
        [
          efectivo("2000.00"),
          { ...mezcla, estado: "CONFORME", por: m.persona, en: `${fechaMezcla}T19:00:00Z` },
        ],
        false,
        "caja_conciliacion_no_cuadra",
      );
      await unaVez(fechaMezcla, [efectivo("2000.00"), mezcla], true);
    });

    it("una jornada sin sesiones tiene una foto vacía y se cierra", async () => {
      const fecha = fechaNueva();
      await conAppDe(b(), m, async (s) => {
        acepta(
          await s.intentar(
            "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
            [m.empresa, m.sucursal, fecha],
          ),
        );
        acepta(
          await s.intentar(
            `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
              where empresa_id = $1 and sucursal_id = $5 and fecha_negocio = $2`,
            [m.empresa, fecha, AHORA, m.persona, m.sucursal],
          ),
        );
        const r = await congelar(s, fecha, []);
        expect(r.ok, r.ok ? "" : `${r.restriccion}: ${r.mensaje}`).toBe(true);
      });
    });
  });

  describe("aislamiento y alcance", () => {
    it("otra empresa no ve ni escribe correcciones, declaraciones ni fotos de esta", async () => {
      const otra = await crearMundo(dueno);
      await conAppDe(b(), otra, async (s) => {
        for (const tabla of [
          "correccion_de_medio",
          "declaracion_de_total",
          "conforme_de_jornada",
          "cierre_de_caja_de_jornada",
          "conciliacion_de_jornada",
          "conciliacion_de_cobro_por_origen",
        ]) {
          const r = filasDe(await s.intentar(`select count(*)::int as n from ${tabla}`));
          expect(r[0]?.["n"], tabla).toBe(0);
        }
        const fecha = fechaNueva();
        expect(
          (
            await s.intentar(
              `insert into conforme_de_jornada (empresa_id, sucursal_id, fecha_negocio, conforme_por, conforme_en, clave_idempotencia, huella)
               values ($1, $2, $3, $4, $5, $6, $7)`,
              [m.empresa, m.sucursal, fecha, otra.persona, AHORA, claveNueva(), HUELLA],
            )
          ).ok,
        ).toBe(false);
      });
    });

    it("un movimiento de la jornada que se corrige no se toca: el cobro original queda como estaba", async () => {
      const fecha = fechaNueva();
      const { cobros } = await jornadaConCobros(fecha, [
        { medio: "TARJETA_CREDITO", cuenta: esc.cuentas.terminal, importe: "100.00" },
      ]);
      const cobro = cobros[0] as string;
      await conAppDe(b(), m, async (s) => {
        acepta(await corregir(s, { cobro, fecha }));
        await s.confirmar();
      });
      const { rows } = await dueno.query<{ medio_de_pago_id: string; importe: string }>(
        "select medio_de_pago_id, importe::text from movimiento_caja where id = $1",
        [cobro],
      );
      expect(rows).toEqual([{ medio_de_pago_id: medioId("TARJETA_CREDITO"), importe: "100.00" }]);
    });
  });
});
