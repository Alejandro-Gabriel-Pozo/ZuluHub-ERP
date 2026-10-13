import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { decidirLimite, reglasDeLimite } from "../../src/plataforma/captacion/dominio/limites";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  contar,
  crearSolicitud,
  emailAlAzar,
  filaDe,
  sesionDeCaptacion,
  type ClaimDeCaptacion,
} from "./captacion-apoyo";
import { AHORA_DE_PRUEBA, comoPlataforma, crearBarrera } from "./entorno";
import type { BaseDePruebas } from "./global";
import { crearMundoDeMarca, marcaPrincipal } from "./marcas-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";
import { baseConCaptacion } from "./captacion-apoyo";

/**
 * Alta por solicitud (L1): CONCURRENCIA e IDEMPOTENCIA contra la base real, con los roles reales y barrera.
 * PS-C1 (dos envíos iguales a la vez: una sola solicitud, un solo trabajo, una sola constancia), PS-C2 (con
 * tope N, de N + 1 intentos simultáneos pasan exactamente N), PS-C3 y PS-C5 en la capa SQL (dos decisiones a
 * la vez: gana una; verificación contra vencimiento; reenvío contra verificación; crear el alta contra
 * rechazar), y la repetición (PS-I1/I2 en la capa SQL): repetir lo mismo no duplica ni falla.
 *
 * Cada carrera corre en `READ COMMITTED` y en `SERIALIZABLE`: en el segundo, la base puede abortar con 40001
 * (que el caso de uso reintenta) en lugar de dejar pasar a la perdedora, pero nunca deja que ganen las dos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Aislamiento = "read committed" | "serializable";
const AISLAMIENTOS: readonly Aislamiento[] = ["read committed", "serializable"];
/** Vueltas de cada carrera: el desenlace tiene que ser el mismo en todas. */
const VUELTAS = 12;

const ADMIN = ADMIN_DE_PRUEBA as string;
const T = AHORA_DE_PRUEBA;

describe.skipIf(base === null)("captación: concurrencia e idempotencia", () => {
  let previa: Awaited<ReturnType<typeof baseConCaptacion>>;
  let dueno: pg.Client;
  let b: BaseDePruebas;
  let marca: string;

  beforeAll(async () => {
    if (base === null) return;
    previa = await baseConCaptacion(base);
    dueno = previa.cliente;
    b = previa.aparte.base;
    marca = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await previa?.cerrar();
  });

  const abrirAdmin = (aislamiento: Aislamiento) =>
    SesionDePrueba.abrir(
      b,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(ADMIN) }),
      aislamiento,
    );
  const abrirSistema = (aislamiento: Aislamiento) =>
    SesionDePrueba.abrir(
      b,
      "zuluhub_plataforma",
      comoPlataforma({ tipo: "SISTEMA", proceso: "barrido-de-solicitudes" }),
      aislamiento,
    );

  type Paso = (s: SesionDePrueba) => Promise<Intento>;

  /**
   * Corre varias transacciones a la vez: cada una en su propia sesión, todas arrancan juntas (barrera) y cada
   * una confirma si todas sus sentencias salieron bien y deshace si no. Devuelve el resultado de cada una.
   */
  async function carrera(
    sesiones: readonly SesionDePrueba[],
    pasos: readonly Paso[],
  ): Promise<Intento[]> {
    const barrera = crearBarrera(sesiones.length);
    try {
      return await Promise.all(
        sesiones.map(async (s, i) => {
          await barrera();
          const r = await (pasos[i] as Paso)(s);
          if (!r.ok) {
            await s.deshacer();
            return r;
          }
          const c = await s.confirmar();
          return c.ok ? r : c;
        }),
      );
    } finally {
      await Promise.all(sesiones.map((s) => s.cerrar()));
    }
  }

  /** Corre varias sentencias seguidas en la misma sesión; se detiene en la primera que falla. */
  const secuencia =
    (...sentencias: ReadonlyArray<readonly [string, readonly unknown[]]>): Paso =>
    async (s) => {
      let ultimo: Intento = { ok: true, filas: 0, rows: [] };
      for (const [texto, parametros] of sentencias) {
        ultimo = await s.directo(texto, [...parametros]);
        if (!ultimo.ok) return ultimo;
      }
      return ultimo;
    };

  const ganaron = (rs: readonly Intento[]) => rs.filter((r) => r.ok);
  /** Un rechazo que el caso de uso reintenta o interpreta: choque de unicidad, o aborto de serialización. */
  const esChoque = (r: Intento) =>
    !r.ok && (r.codigo === "23505" || r.codigo === "40001" || r.codigo === "23514");

  // ==========================================================================================================
  // PS-C1: dos envíos iguales a la vez
  // ==========================================================================================================
  describe.each(AISLAMIENTOS)(
    "PS-C1 (%s): dos envíos del mismo formulario a la vez",
    (aislamiento) => {
      const INSERTAR = `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro,
        version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en)
      values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3) returning id`;

      /** Lo que hace `enviarSolicitud` al crear: la solicitud, el correo de verificación y la constancia, en una transacción. */
      const crearYEncolar =
        (email: string): Paso =>
        async (s) => {
          const creada = await s.directo(INSERTAR, [marca, email, T]);
          if (!creada.ok) return creada;
          const id = creada.rows[0]?.["id"] as string;
          const trabajo = await s.directo(
            `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
           values (null, 'enviar_verificacion_de_solicitud', $1::jsonb, $2) on conflict do nothing`,
            [JSON.stringify({ solicitudId: id }), `solicitud:${id}:verificacion:1`],
          );
          if (!trabajo.ok) return trabajo;
          return s.directo(
            `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, despues)
           values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1, '{"estado":"NUEVA"}'::jsonb)`,
            [id],
          );
        };

      it(`dos creaciones simultáneas del mismo correo y marca dejan UNA solicitud, UN trabajo y UNA constancia (${VUELTAS} vueltas)`, async () => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const email = emailAlAzar();
          const claim: ClaimDeCaptacion = { m: marca, e: email };
          const sesiones = await Promise.all([
            sesionDeCaptacion(b, claim, aislamiento),
            sesionDeCaptacion(b, claim, aislamiento),
          ]);
          const rs = await carrera(sesiones, [crearYEncolar(email), crearYEncolar(email)]);
          expect(ganaron(rs), `vuelta ${vuelta}: una sola gana`).toHaveLength(1);
          const perdedora = rs.find((r) => !r.ok) as Intento;
          // la perdedora choca con la única de las abiertas (o la serialización la aborta): el caso de uso reintenta,
          // lee la fila de la ganadora y responde lo mismo que siempre
          expect(!perdedora.ok && ["23505", "40001"].includes(perdedora.codigo)).toBe(true);
          if (!perdedora.ok && perdedora.codigo === "23505") {
            expect(perdedora.restriccion).toBe("solicitud_abierta_uk");
          }
          const solicitudes = await dueno.query<{ id: string }>(
            "select id from solicitud_de_alta where marca_id = $1 and email = $2",
            [marca, email],
          );
          expect(solicitudes.rows, `vuelta ${vuelta}`).toHaveLength(1);
          const id = solicitudes.rows[0]?.id as string;
          expect(
            await contar(dueno, "trabajo", `clave_idempotencia like 'solicitud:${id}:%'`),
          ).toBe(1);
          expect(await contar(dueno, "auditoria_plataforma", `entidad_id = '${id}'`)).toBe(1);
        }
      });

      it("el mismo reintento, ya con la solicitud creada, no duplica nada: el INSERT … ON CONFLICT DO NOTHING no inserta y no falla", async () => {
        const email = emailAlAzar();
        const s = await sesionDeCaptacion(b, { m: marca, e: email }, aislamiento);
        try {
          const sentencia = `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro,
            version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en)
          values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3)
          on conflict (marca_id, email) where estado in ('NUEVA', 'VERIFICADA', 'APROBADA') do nothing returning id`;
          const primera = await s.directo(sentencia, [marca, email, T]);
          expect(primera.ok && primera.rows).toHaveLength(1);
          const segunda = await s.directo(sentencia, [marca, email, T]);
          expect(segunda.ok && segunda.rows).toHaveLength(0);
          expect((await s.confirmar()).ok).toBe(true);
        } finally {
          await s.cerrar();
        }
        expect(await contar(dueno, "solicitud_de_alta", `email = '${email}'`)).toBe(1);
      });

      it("la perdedora que esperaba el candado del índice único ve la fila de la ganadora cuando esta confirma (no se pisan)", async () => {
        const email = emailAlAzar();
        const claim: ClaimDeCaptacion = { m: marca, e: email };
        const [primera, segunda] = await Promise.all([
          sesionDeCaptacion(b, claim, aislamiento),
          sesionDeCaptacion(b, claim, aislamiento),
        ]);
        try {
          const a = await primera.directo(INSERTAR, [marca, email, T]);
          expect(a.ok).toBe(true);
          // la segunda se queda esperando el índice único hasta que la primera termine
          const espera = segunda.directo(INSERTAR, [marca, email, T]);
          expect(await esperarBloqueo(dueno, segunda.pid)).toBe(true);
          expect((await primera.confirmar()).ok).toBe(true);
          const r = await espera;
          expect(!r.ok && ["23505", "40001"].includes(r.codigo)).toBe(true);
        } finally {
          await primera.cerrar();
          await segunda.cerrar();
        }
        expect(await contar(dueno, "solicitud_de_alta", `email = '${email}'`)).toBe(1);
      });

      it("si la primera deshace, la segunda crea la suya (el lugar de la abierta queda libre)", async () => {
        const email = emailAlAzar();
        const claim: ClaimDeCaptacion = { m: marca, e: email };
        const [primera, segunda] = await Promise.all([
          sesionDeCaptacion(b, claim, aislamiento),
          sesionDeCaptacion(b, claim, aislamiento),
        ]);
        try {
          expect((await primera.directo(INSERTAR, [marca, email, T])).ok).toBe(true);
          const espera = segunda.directo(INSERTAR, [marca, email, T]);
          expect(await esperarBloqueo(dueno, segunda.pid)).toBe(true);
          await primera.deshacer();
          const r = await espera;
          expect(r.ok).toBe(true);
          expect((await segunda.confirmar()).ok).toBe(true);
        } finally {
          await primera.cerrar();
          await segunda.cerrar();
        }
        expect(await contar(dueno, "solicitud_de_alta", `email = '${email}'`)).toBe(1);
      });

      it("dos correos de verificación con la misma clave a la vez dejan UN trabajo (sin error para ninguno)", async () => {
        const s1 = await crearSolicitud(dueno, { marca });
        const claim: ClaimDeCaptacion = { s: s1.id };
        const encolar = secuencia([
          `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
         values (null, 'enviar_verificacion_de_solicitud', $1::jsonb, $2) on conflict do nothing`,
          [JSON.stringify({ solicitudId: s1.id }), `solicitud:${s1.id}:verificacion:1`],
        ]);
        const sesiones = await Promise.all([
          sesionDeCaptacion(b, claim, aislamiento),
          sesionDeCaptacion(b, claim, aislamiento),
          sesionDeCaptacion(b, claim, aislamiento),
        ]);
        const rs = await carrera(sesiones, [encolar, encolar, encolar]);
        // en READ COMMITTED las tres tienen éxito (dos sin insertar); en SERIALIZABLE puede haber algún 40001
        for (const r of rs)
          expect(r.ok || (!r.ok && r.codigo === "40001"), JSON.stringify(r)).toBe(true);
        expect(
          await contar(
            dueno,
            "trabajo",
            `clave_idempotencia = 'solicitud:${s1.id}:verificacion:1'`,
          ),
        ).toBe(1);
      });
    },
  );

  // ==========================================================================================================
  // PS-C2: el tope de los contadores
  // ==========================================================================================================
  describe.each(AISLAMIENTOS)(
    "PS-C2 (%s): con tope N, de N + 1 intentos simultáneos pasan exactamente N",
    (aislamiento) => {
      const CONTAR = `insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'HORA', $2, 1)
      on conflict (clave, ventana, ventana_inicio) do update set cuenta = limite_de_captacion.cuenta + 1
      returning cuenta`;

      it("11 intentos a la vez con el tope de la IP por hora (10): las cuentas son 1..11 sin repetir y pasan exactamente 10", async () => {
        const regla = reglasDeLimite({ topeGlobalDeVerificacionesPorDia: 50 }).find(
          (r) => r.capa === "IP" && r.ventana === "HORA",
        ) as NonNullable<ReturnType<typeof reglasDeLimite>[number]>;
        const intentos = regla.tope + 1;
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          const clave = `ip:${randomBytes(32).toString("hex")}`;
          const sesiones = await Promise.all(
            Array.from({ length: intentos }, () => sesionDeCaptacion(b, {}, aislamiento)),
          );
          const reintentos: number[] = [];
          const rs = await carrera(
            sesiones,
            sesiones.map(() => async (s: SesionDePrueba) => s.directo(CONTAR, [clave, T])),
          );
          // en SERIALIZABLE alguna puede abortar (40001) y el caso la reintenta: se reintenta acá una por una
          const cuentas: number[] = [];
          for (const r of rs) {
            if (r.ok) {
              cuentas.push(r.rows[0]?.["cuenta"] as number);
              continue;
            }
            expect(r.codigo, r.mensaje).toBe("40001");
            reintentos.push(1);
            const s = await sesionDeCaptacion(b, {}, aislamiento);
            const [otra] = await carrera([s], [async (x) => x.directo(CONTAR, [clave, T])]);
            expect(otra?.ok).toBe(true);
            cuentas.push((otra?.ok ? otra.rows[0]?.["cuenta"] : 0) as number);
          }
          expect(
            [...cuentas].sort((x, y) => x - y),
            `vuelta ${vuelta}`,
          ).toEqual(Array.from({ length: intentos }, (_, i) => i + 1));
          const pasaron = cuentas.filter(
            (cuenta) => decidirLimite([{ regla, cuenta }]).tipo === "PERMITIDO",
          );
          expect(pasaron, `vuelta ${vuelta}`).toHaveLength(regla.tope);
          void reintentos;
        }
      });

      it("la primera cuenta de una clave nueva, pedida por dos a la vez, es 1 y 2 (el INSERT y el UPDATE no se pisan)", async () => {
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          const clave = `correo:${randomBytes(32).toString("hex")}`;
          const sesiones = await Promise.all([
            sesionDeCaptacion(b, {}, "read committed"),
            sesionDeCaptacion(b, {}, "read committed"),
          ]);
          const rs = await carrera(
            sesiones,
            sesiones.map(() => async (s: SesionDePrueba) => s.directo(CONTAR, [clave, T])),
          );
          expect(
            rs.map((r) => (r.ok ? (r.rows[0]?.["cuenta"] as number) : -1)).sort(),
            `vuelta ${vuelta}`,
          ).toEqual([1, 2]);
        }
      });
    },
  );

  // ==========================================================================================================
  // PS-C3 / PS-C5 en la capa SQL: una sola decisión gana
  // ==========================================================================================================
  describe.each(AISLAMIENTOS)(
    "PS-C3/C5 (%s): dos cambios de la misma solicitud a la vez, uno gana",
    (aislamiento) => {
      const decidir = (estado: string, extra = "") =>
        `update solicitud_de_alta set estado = '${estado}', decidida_por = $3, decidida_en = $4${extra}
       where id = $1 and version = $2 returning version`;

      it(`aprobar y rechazar a la vez (con la versión esperada): gana UNO, el otro no encuentra la fila (${VUELTAS} vueltas)`, async () => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const s1 = await crearSolicitud(dueno, { marca, estado: "VERIFICADA" });
          const v = (await filaDe(dueno, s1.id))["version"] as number;
          const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
          const rs = await carrera(sesiones, [
            async (s) => s.directo(decidir("APROBADA"), [s1.id, v, ADMIN, T]),
            async (s) =>
              s.directo(decidir("RECHAZADA", ", motivo_de_rechazo = 'OTRO'"), [s1.id, v, ADMIN, T]),
          ]);
          // gana una sola fila: o la otra encuentra 0 filas (READ COMMITTED) o aborta por serialización
          const exitosas = rs.filter((r) => r.ok && r.filas === 1);
          expect(exitosas, `vuelta ${vuelta}: ${JSON.stringify(rs)}`).toHaveLength(1);
          for (const r of rs) {
            if (!r.ok) expect(r.codigo).toBe("40001");
            else if (r.filas === 0) expect(aislamiento).toBe("read committed");
          }
          const fila = await filaDe(dueno, s1.id);
          expect(["APROBADA", "RECHAZADA"]).toContain(fila["estado"]);
          expect(fila["version"]).toBe(v + 1);
          expect(fila["decidida_por"]).toBe(ADMIN);
        }
      });

      it("rechazar a la vez que se marca spam, sin versión esperada: el segundo cambio ve el estado nuevo y la base lo frena (no hay dos decisiones)", async () => {
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          const s1 = await crearSolicitud(dueno, { marca, estado: "VERIFICADA" });
          const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
          const rs = await carrera(sesiones, [
            async (s) =>
              s.directo(
                "update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'OTRO', decidida_por = $2, decidida_en = $3 where id = $1",
                [s1.id, ADMIN, T],
              ),
            async (s) =>
              s.directo(
                "update solicitud_de_alta set estado = 'SPAM', decidida_por = $2, decidida_en = $3 where id = $1",
                [s1.id, ADMIN, T],
              ),
          ]);
          // ambas parten de VERIFICADA: la que llega segunda ve RECHAZADA o SPAM (terminales) y el disparador la frena
          expect(ganaron(rs), `vuelta ${vuelta}`).toHaveLength(1);
          expect(rs.filter(esChoque), `vuelta ${vuelta}`).toHaveLength(1);
          expect(["RECHAZADA", "SPAM"]).toContain((await filaDe(dueno, s1.id))["estado"]);
        }
      });

      it("crear el alta a la vez que rechazar (APROBADA): gana uno; las dos altas con distinta empresa no pueden ser las dos", async () => {
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          const s1 = await crearSolicitud(dueno, { marca, estado: "APROBADA" });
          const e1 = (await crearMundoDeMarca(dueno, { marca })).empresa;
          const e2 = (await crearMundoDeMarca(dueno, { marca })).empresa;
          const v = (await filaDe(dueno, s1.id))["version"] as number;
          const sesiones = await Promise.all([
            abrirAdmin(aislamiento),
            abrirAdmin(aislamiento),
            abrirAdmin(aislamiento),
          ]);
          const alta = (empresa: string) => async (s: SesionDePrueba) =>
            s.directo(decidir("ALTA_CREADA", ", empresa_creada_id = $5"), [
              s1.id,
              v,
              ADMIN,
              T,
              empresa,
            ]);
          const rs = await carrera(sesiones, [
            alta(e1),
            alta(e2),
            async (s) =>
              s.directo(decidir("RECHAZADA", ", motivo_de_rechazo = 'OTRO'"), [s1.id, v, ADMIN, T]),
          ]);
          expect(
            rs.filter((r) => r.ok && r.filas === 1),
            `vuelta ${vuelta}`,
          ).toHaveLength(1);
          const fila = await filaDe(dueno, s1.id);
          expect(["ALTA_CREADA", "RECHAZADA"]).toContain(fila["estado"]);
          // el estado y la empresa siempre van juntos (solicitud_alta_ck)
          expect(fila["estado"] === "ALTA_CREADA").toBe(fila["empresa_creada_id"] !== null);
        }
      });

      it("dos altas de una APROBADA sin versión esperada: la segunda no cambia una solicitud ya dada de alta (solicitud_decision_sin_cambio)", async () => {
        const s1 = await crearSolicitud(dueno, { marca, estado: "APROBADA" });
        const e1 = (await crearMundoDeMarca(dueno, { marca })).empresa;
        const e2 = (await crearMundoDeMarca(dueno, { marca })).empresa;
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const sentencia =
          "update solicitud_de_alta set estado = 'ALTA_CREADA', decidida_por = $2, decidida_en = $3, empresa_creada_id = $4 where id = $1";
        const rs = await carrera(sesiones, [
          async (s) => s.directo(sentencia, [s1.id, ADMIN, T, e1]),
          async (s) => s.directo(sentencia, [s1.id, ADMIN, T, e2]),
        ]);
        expect(ganaron(rs)).toHaveLength(1);
        const perdedora = rs.find((r) => !r.ok) as Intento;
        expect(!perdedora.ok && ["23514", "40001"].includes(perdedora.codigo)).toBe(true);
        if (!perdedora.ok && perdedora.codigo === "23514") {
          expect(perdedora.restriccion).toBe("solicitud_decision_sin_cambio");
        }
      });

      it("dos solicitudes distintas no pueden quedarse con la misma empresa creada (solicitud_empresa_uk)", async () => {
        const a = await crearSolicitud(dueno, { marca, estado: "APROBADA" });
        const c = await crearSolicitud(dueno, { marca, estado: "APROBADA" });
        const empresa = (await crearMundoDeMarca(dueno, { marca })).empresa;
        const sesiones = await Promise.all([abrirAdmin(aislamiento), abrirAdmin(aislamiento)]);
        const sentencia =
          "update solicitud_de_alta set estado = 'ALTA_CREADA', decidida_por = $2, decidida_en = $3, empresa_creada_id = $4 where id = $1";
        const rs = await carrera(sesiones, [
          async (s) => s.directo(sentencia, [a.id, ADMIN, T, empresa]),
          async (s) => s.directo(sentencia, [c.id, ADMIN, T, empresa]),
        ]);
        expect(ganaron(rs)).toHaveLength(1);
        const perdedora = rs.find((r) => !r.ok) as Intento;
        expect(!perdedora.ok && ["23505", "40001"].includes(perdedora.codigo)).toBe(true);
      });

      it("verificar a la vez que vence a los 7 días (con el estado NUEVA como condición): gana uno y el desenlace es coherente", async () => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const n = await crearSolicitud(dueno, { marca });
          const [sc, ss] = await Promise.all([
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
            abrirSistema(aislamiento),
          ]);
          const rs = await carrera(
            [sc, ss],
            [
              async (s) =>
                s.directo(
                  "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
                  [n.id, T],
                ),
              async (s) =>
                s.directo(
                  `update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'NO_VERIFICADA',
                   decidida_por = 'sistema', decidida_en = $2 where id = $1 and estado = 'NUEVA'`,
                  [n.id, T],
                ),
            ],
          );
          const filasLogradas = rs.filter((r) => r.ok && r.filas === 1);
          expect(filasLogradas, `vuelta ${vuelta}: ${JSON.stringify(rs)}`).toHaveLength(1);
          for (const r of rs) if (!r.ok) expect(r.codigo).toBe("40001");
          const fila = await filaDe(dueno, n.id);
          if (fila["estado"] === "VERIFICADA") {
            expect(fila["verificada_en"]).toEqual(T);
            expect(fila["decidida_por"]).toBeNull();
          } else {
            expect(fila["estado"]).toBe("RECHAZADA");
            expect(fila["verificada_en"]).toBeNull();
            expect(fila["decidida_por"]).toBe("sistema");
          }
        }
      });

      it("aunque el barrido NO ponga la condición de estado, la base no deja rechazar por NO_VERIFICADA lo que se verificó (CHECK)", async () => {
        for (let vuelta = 0; vuelta < 6; vuelta++) {
          const n = await crearSolicitud(dueno, { marca });
          const [sc, ss] = await Promise.all([
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
            abrirSistema(aislamiento),
          ]);
          const rs = await carrera(
            [sc, ss],
            [
              async (s) =>
                s.directo(
                  "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
                  [n.id, T],
                ),
              async (s) =>
                s.directo(
                  `update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'NO_VERIFICADA',
                   decidida_por = 'sistema', decidida_en = $2 where id = $1`,
                  [n.id, T],
                ),
            ],
          );
          const fila = await filaDe(dueno, n.id);
          // o gana la verificación y el barrido es rechazado por la CHECK, o gana el barrido y la verificación no encuentra la fila
          if (fila["estado"] === "VERIFICADA") {
            const barrido = rs[1] as Intento;
            expect(
              !barrido.ok && ["23514", "40001"].includes(barrido.codigo),
              JSON.stringify(rs),
            ).toBe(true);
          } else {
            expect(fila["estado"]).toBe("RECHAZADA");
            expect(fila["verificada_en"]).toBeNull();
          }
        }
      });

      it("reenviar a la vez que se verifica: o se reenvía y se verifica (los dos), o se verifica primero y el reenvío no encuentra una NUEVA", async () => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const n = await crearSolicitud(dueno, { marca });
          const [s1, s2] = await Promise.all([
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
          ]);
          const rs = await carrera(
            [s1, s2],
            [
              async (s) =>
                s.directo(
                  "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = $2 where id = $1 and estado = 'NUEVA' and numero_de_envios = 1",
                  [n.id, new Date(T.getTime() + 120_000)],
                ),
              async (s) =>
                s.directo(
                  "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
                  [n.id, T],
                ),
            ],
          );
          for (const r of rs) if (!r.ok) expect(r.codigo).toBe("40001");
          const fila = await filaDe(dueno, n.id);
          // en cualquier orden la fila queda coherente: VERIFICADA con 1 o 2 envíos, o NUEVA con 2 (si abortó la verificación)
          expect(["NUEVA", "VERIFICADA"]).toContain(fila["estado"]);
          expect([1, 2]).toContain(fila["numero_de_envios"]);
          if (fila["estado"] === "VERIFICADA") expect(fila["verificada_en"]).toEqual(T);
          else expect(fila["verificada_en"]).toBeNull();
        }
      });

      it("dos verificaciones a la vez (el enlace abierto dos veces): una cambia la fila, la otra no encuentra una NUEVA (y no es un error)", async () => {
        for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
          const n = await crearSolicitud(dueno, { marca });
          const sesiones = await Promise.all([
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
            sesionDeCaptacion(b, { s: n.id }, aislamiento),
          ]);
          const verificar = async (s: SesionDePrueba) =>
            s.directo(
              "update solicitud_de_alta set estado = 'VERIFICADA', verificada_en = $2 where id = $1 and estado = 'NUEVA'",
              [n.id, T],
            );
          const rs = await carrera(sesiones, [verificar, verificar]);
          const logradas = rs.filter((r) => r.ok && r.filas === 1);
          expect(logradas, `vuelta ${vuelta}: ${JSON.stringify(rs)}`).toHaveLength(1);
          for (const r of rs) {
            if (r.ok) continue;
            expect(r.codigo).toBe("40001");
          }
          expect((await filaDe(dueno, n.id))["version"]).toBe(2);
        }
      });
    },
  );

  // ==========================================================================================================
  // PS-I1/I2 en la capa SQL: repetir lo mismo no duplica ni falla
  // ==========================================================================================================
  describe("repetir lo mismo no duplica efectos", () => {
    it("el aviso al dueño y la constancia de verificación se encolan una vez aunque el manejador corra dos veces", async () => {
      const n = await crearSolicitud(dueno, { marca, estado: "VERIFICADA" });
      const encolar = (s: SesionDePrueba) =>
        s.directo(
          `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
           values (null, 'avisar_solicitud_verificada', $1::jsonb, $2) on conflict do nothing`,
          [JSON.stringify({ solicitudId: n.id }), `solicitud:${n.id}:aviso`],
        );
      for (const aislamiento of AISLAMIENTOS) {
        const s = await sesionDeCaptacion(b, { s: n.id }, aislamiento);
        try {
          expect((await encolar(s)).ok).toBe(true);
          expect((await s.confirmar()).ok).toBe(true);
        } finally {
          await s.cerrar();
        }
      }
      expect(await contar(dueno, "trabajo", `clave_idempotencia = 'solicitud:${n.id}:aviso'`)).toBe(
        1,
      );
    });

    it("la misma operación de contadores repetida solo suma: nunca duplica la fila de la ventana", async () => {
      const clave = `ip:${randomBytes(32).toString("hex")}`;
      for (let i = 1; i <= 4; i++) {
        const s = await sesionDeCaptacion(b, {}, "read committed");
        try {
          const r = await s.directo(
            `insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, 'DIA', $2, 1)
             on conflict (clave, ventana, ventana_inicio) do update set cuenta = limite_de_captacion.cuenta + 1 returning cuenta`,
            [clave, T],
          );
          expect(r.ok && r.rows[0]?.["cuenta"]).toBe(i);
          await s.confirmar();
        } finally {
          await s.cerrar();
        }
      }
      expect(await contar(dueno, "limite_de_captacion", `clave = '${clave}'`)).toBe(1);
    });

    it("los barridos repetidos no encuentran nada: anonimizar una solicitud ya anonimizada afecta 0 filas por la condición de las consultas, y no hay forma de hacerlo dos veces a la base", async () => {
      const c = await crearSolicitud(dueno, { marca, estado: "SPAM" });
      const anonimizar = `update solicitud_de_alta set anonimizada_en = $2, email = null, nombre_contacto = null,
          nombre_negocio = null, telefono = null, cuit = null, id_de_medicion = null, nota_interna = null,
          atribucion = atribucion - 'fbclid' where id = $1 and anonimizada_en is null`;
      const s = await abrirSistema("read committed");
      try {
        const primera = await s.directo(anonimizar, [c.id, T]);
        expect(primera.ok && primera.filas).toBe(1);
        // la consulta del barrido filtra `anonimizada_en IS NULL`: la segunda corrida no encuentra nada
        const segunda = await s.directo(anonimizar, [c.id, T]);
        expect(segunda.ok && segunda.filas).toBe(0);
        // y sin ese filtro, la base se niega (el disparador): repetirlo a ciegas no pisa nada
        const ciega = await s.directo(anonimizar.replace(" and anonimizada_en is null", ""), [
          c.id,
          T,
        ]);
        expect(!ciega.ok && ciega.codigo).toBe("23514");
      } finally {
        await s.deshacer();
        await s.cerrar();
      }
    });

    it("una escritura que falla a mitad de camino no deja nada: la solicitud, el trabajo y la constancia van juntos o ninguno", async () => {
      const email = emailAlAzar();
      const s = await sesionDeCaptacion(b, { m: marca, e: email });
      const antesDeTrabajos = await contar(
        dueno,
        "trabajo",
        "tipo = 'enviar_verificacion_de_solicitud'",
      );
      const antesDeAuditorias = await contar(dueno, "auditoria_plataforma", "actor = 'captacion'");
      try {
        const creada = await s.directo(
          `insert into solicitud_de_alta (marca_id, email, nombre_contacto, nombre_negocio, rubro,
             version_de_terminos, version_de_privacidad, ultimo_envio_en, creada_en)
           values ($1, $2, 'Ana', 'Café', 'bar', '2026-10-13', '2026-10-13.1', $3, $3) returning id`,
          [marca, email, T],
        );
        const id = (creada.ok ? creada.rows[0]?.["id"] : randomUUID()) as string;
        expect(
          (
            await s.directo(
              `insert into trabajo (empresa_id, tipo, datos, clave_idempotencia)
               values (null, 'enviar_verificacion_de_solicitud', $1::jsonb, $2)`,
              [JSON.stringify({ solicitudId: id }), `solicitud:${id}:verificacion:1`],
            )
          ).ok,
        ).toBe(true);
        // la constancia falla (una clave de más) y se deshace todo
        const mala = await s.directo(
          `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, despues)
           values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1, '{"email":"x@y.z"}'::jsonb)`,
          [id],
        );
        expect(mala.ok).toBe(false);
        await s.deshacer();
      } finally {
        await s.cerrar();
      }
      expect(await contar(dueno, "solicitud_de_alta", `email = '${email}'`)).toBe(0);
      expect(await contar(dueno, "trabajo", "tipo = 'enviar_verificacion_de_solicitud'")).toBe(
        antesDeTrabajos,
      );
      expect(await contar(dueno, "auditoria_plataforma", "actor = 'captacion'")).toBe(
        antesDeAuditorias,
      );
    });
  });
});
