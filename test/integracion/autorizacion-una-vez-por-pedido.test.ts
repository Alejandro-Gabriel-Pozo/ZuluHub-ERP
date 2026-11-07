import { writeFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../../src/adaptadores/postgres/autorizacion";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA } from "../../src/capacidades/permisos/roles";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearConsultasDeEmpresas } from "../../src/modulos/empresas/publico";
import {
  empresaId,
  marcaComercialId,
  personaId,
  type MarcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
} from "./fixtures-identidad";
import {
  asignarPlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlanPublicado,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * EQUIVALENCIA: resolver los permisos una vez por pedido (una transacción de lectura compartida y la memoria de permisos de esa
 * transacción) NO cambia quién puede qué. Para una matriz de personas × roles × estados de membresía y de persona × asignaciones de
 * sucursal (abiertas, cerradas, apagadas) × módulos de la empresa (activo, solo lectura, sin activar, sin plan) × marca de entrada
 * (correcta, otra, ninguna), el resultado de las consultas de autorización es IDÉNTICO entre:
 *   - ANTES: cada consulta con su transacción y el adaptador sin memoria (exactamente cómo se leía), y
 *   - DESPUÉS: las mismas consultas dentro de un pedido que comparte la transacción y con la memoria de permisos.
 * Si algún día difieren, esta prueba dice en qué combinación. Con `TABLA_DE_EQUIVALENCIA=<archivo>` deja la tabla en Markdown.
 */

const base = inject("baseDePruebas");

type EstadoDeMembresia = "ACTIVA" | "DESACTIVADA" | "AJENA";
type EstadoDePersona = "ACTIVA" | "SUSPENDIDA";
type Asignacion = "NINGUNA" | "ABIERTA" | "CERRADA" | "APAGADA" | "ABIERTA+CERRADA";
type Escenario = "ACTIVO" | "SOLO_LECTURA" | "SIN_ACTIVAR" | "SIN_PLAN";
const ESCENARIOS: readonly Escenario[] = ["ACTIVO", "SOLO_LECTURA", "SIN_ACTIVAR", "SIN_PLAN"];
type Marca = "CORRECTA" | "OTRA" | "NINGUNA";
const MARCAS: readonly Marca[] = ["CORRECTA", "OTRA", "NINGUNA"];

type Fila = Readonly<{
  rol: string;
  membresia: EstadoDeMembresia;
  persona: EstadoDePersona;
  asignacion: Asignacion;
  escenario: Escenario;
  marca: Marca;
  /** Lo que resolvió el conjunto de consultas, resumido para la tabla. */
  resumen: string;
  /** Lo completo, para comparar. */
  completo: unknown;
}>;

describe.skipIf(base === null)(
  "autorización una vez por pedido: equivalencia con la lectura de siempre",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    // ANTES: cada consulta con su transacción, adaptador sin memoria. DESPUÉS: el entorno real (memoria en lectura + pedido compartido).
    let antes: ReturnType<typeof crearEntornoDePrueba>;
    let despues: ReturnType<typeof crearEntornoDePrueba>;
    let marcaA: MarcaComercialId;
    let marcaB: MarcaComercialId;
    type Juego = Map<Escenario, { empresa: string; sucursales: readonly string[] }>;
    /** Cada gerente necesita sus propias empresas (hay un solo gerente por empresa): los demás roles comparten el juego 0. */
    const juegos: Juego[] = [];
    const personas: Array<{
      id: string;
      rol: string;
      membresia: EstadoDeMembresia;
      persona: EstadoDePersona;
      asignacion: Asignacion;
      juego: Juego;
    }> = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      antes = crearEntornoDePrueba(propia.base, 3, (tx) => ({
        ...tx,
        autorizacion: crearAutorizacionDePostgres(tx.db.withTables<AutorizacionDb>()),
      }));
      despues = crearEntornoDePrueba(propia.base, 3);
      const principal = await marcaPrincipal(dueno);
      marcaA = marcaComercialId(await crearMarca(dueno, { padre: principal }));
      marcaB = marcaComercialId(await crearMarca(dueno, { padre: principal }));

      const conFacturacion = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
      const sinFacturacion = await crearPlanPublicado(dueno, { modulos: ["administracion"] });
      const crearJuego = async (): Promise<Juego> => {
        const juego: Juego = new Map();
        for (const escenario of ESCENARIOS) {
          const m = await crearMundoDeMarca(dueno, { marca: marcaA });
          const s2 = (
            await dueno.query<{ id: string }>(
              "insert into sucursal (empresa_id, nombre) values ($1, 'Anexo') returning id",
              [m.empresa],
            )
          ).rows[0]?.id as string;
          const s3 = (
            await dueno.query<{ id: string }>(
              "insert into sucursal (empresa_id, nombre, activa) values ($1, 'Cerrada', false) returning id",
              [m.empresa],
            )
          ).rows[0]?.id as string;
          juego.set(escenario, { empresa: m.empresa, sucursales: [m.sucursal, s2, s3] });
          if (escenario === "ACTIVO") await asignarPlan(dueno, m.tenant, conFacturacion.version);
          if (escenario === "SOLO_LECTURA")
            await asignarPlan(dueno, m.tenant, sinFacturacion.version);
          if (escenario === "SIN_ACTIVAR")
            await asignarPlan(dueno, m.tenant, conFacturacion.version);
          if (escenario === "ACTIVO" || escenario === "SOLO_LECTURA" || escenario === "SIN_PLAN") {
            await dueno.query(
              "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
              [m.empresa],
            );
          }
        }
        return juego;
      };
      juegos.push(await crearJuego());

      const asignaciones: readonly Asignacion[] = [
        "NINGUNA",
        "ABIERTA",
        "CERRADA",
        "APAGADA",
        "ABIERTA+CERRADA",
      ];
      for (const rol of ROLES_DE_EMPRESA) {
        for (const membresia of ["ACTIVA", "DESACTIVADA", "AJENA"] as const) {
          for (const persona of ["ACTIVA", "SUSPENDIDA"] as const) {
            for (const asignacion of rol === "OPERADOR" ? asignaciones : (["NINGUNA"] as const)) {
              const p = await crearPersonaDeBase(dueno);
              if (persona === "SUSPENDIDA") {
                await dueno.query("update persona set activo_global = false where id = $1", [p.id]);
              }
              const juego = rol === "GERENTE" ? await crearJuego() : (juegos[0] as Juego);
              if (rol === "GERENTE") juegos.push(juego);
              for (const { empresa, sucursales } of juego.values()) {
                if (membresia === "AJENA") continue;
                await crearMembresiaDeBase(dueno, empresa, p.id, rol, membresia === "ACTIVA");
                const [abierta, anexo, cerrada] = sucursales as [string, string, string];
                if (asignacion === "ABIERTA" || asignacion === "ABIERTA+CERRADA") {
                  await crearAsignacionDeBase(dueno, empresa, p.id, abierta);
                }
                if (asignacion === "CERRADA" || asignacion === "ABIERTA+CERRADA") {
                  await crearAsignacionDeBase(dueno, empresa, p.id, cerrada);
                }
                if (asignacion === "APAGADA") {
                  await crearAsignacionDeBase(dueno, empresa, p.id, anexo, false);
                }
              }
              if (membresia === "AJENA") {
                // Es miembro, pero de OTRA empresa (otro tenant): en las de la matriz no tiene membresía.
                const otra = await crearMundoDeMarca(dueno, { marca: marcaA });
                await crearMembresiaDeBase(dueno, otra.empresa, p.id, rol, true);
              }
              personas.push({ id: p.id, rol, membresia, persona, asignacion, juego });
            }
          }
        }
      }
    }, 120_000);
    afterAll(async () => {
      await dueno.end();
      await antes.cerrar();
      await despues.cerrar();
      await propia.destruir();
    });

    const contextoDe = (empresa: string, persona: string, marca: Marca): ContextoOperativo => ({
      tipo: "OPERATIVO",
      empresaId: empresaId(empresa),
      personaId: personaId(persona),
      marcaDeEntrada: marca === "CORRECTA" ? marcaA : marca === "OTRA" ? marcaB : null,
      // El plan de las empresas rige desde hace unos segundos: con la fecha fija de las demás pruebas todavía no regiría.
      ahora: new Date(),
    });

    /** Todo lo que un pedido pregunta sobre permisos: las consultas reales de empresas y la carga de autorización del adaptador. */
    async function preguntar(
      entorno: ReturnType<typeof crearEntornoDePrueba>,
      contexto: ContextoOperativo,
      compartir: boolean,
    ) {
      const consultas = crearConsultasDeEmpresas({
        transacciones: entorno,
        reglas: REGLAS_DE_EMPRESA,
      });
      const todo = async () => {
        const permisos = await consultas.permisosDelActor(contexto);
        const elegibles = await consultas.sucursalesElegibles(contexto);
        const listadas = await consultas.listarSucursales(contexto, { incluirInactivas: false });
        const adaptador = await entorno.ejecutar(
          { contexto, aislamiento: "read committed", soloLectura: true },
          async (tx) =>
            ok({
              actor: await tx.autorizacion.delActor(contexto),
              todas: await tx.autorizacion.sucursalesDelActor(contexto, {
                incluirDesactivadas: true,
              }),
              abiertas: await tx.autorizacion.sucursalesDelActor(contexto),
            }),
        );
        return { permisos, elegibles, listadas, adaptador };
      };
      return compartir ? entorno.conLecturasCompartidas(contexto, todo) : todo();
    }

    /** El resultado sin los ids de esta corrida (sucursales y empresa por posición): comparable entre corridas. */
    const normalizar = (
      valor: unknown,
      e: Readonly<{ empresa: string; sucursales: readonly string[] }>,
    ): unknown => {
      const conPosiciones: unknown = JSON.parse(
        JSON.stringify(valor, (_clave, v: unknown) => {
          if (typeof v !== "string") return v;
          const posicion = e.sucursales.indexOf(v);
          if (posicion >= 0) return `S${posicion}`;
          return v === e.empresa ? "E" : v;
        }),
      );
      // La lista de sucursales sale ordenada por id, y el id cambia en cada corrida: por posición, en orden.
      const ordenar = (x: unknown): unknown => {
        if (Array.isArray(x)) {
          const hijos = x.map(ordenar);
          return hijos.every((h) => typeof h === "string" && /^S\d$/.test(h))
            ? hijos.sort()
            : hijos;
        }
        if (typeof x === "object" && x !== null) {
          return Object.fromEntries(Object.entries(x).map(([k, h]) => [k, ordenar(h)]));
        }
        return x;
      };
      return ordenar(conPosiciones);
    };

    const resumir = (c: Awaited<ReturnType<typeof preguntar>>): string => {
      const p = c.permisos.ok
        ? `${c.permisos.valor.acciones.length} acciones; activos=${c.permisos.valor.modulos.activos.join("+") || "-"}; solo lectura=${c.permisos.valor.modulos.enSoloLectura.join("+") || "-"}`
        : `permisos: ${"error" in c.permisos && typeof c.permisos.error === "string" ? c.permisos.error : "rechazo"}`;
      const e = c.elegibles.ok
        ? `${c.elegibles.valor.length} sucursales elegibles`
        : "elegir: rechazo";
      const l = c.listadas.ok ? `${c.listadas.valor.length} listadas` : "listar: rechazo";
      return `${p}; ${e}; ${l}`;
    };

    it("la matriz completa da el MISMO resultado antes y después, y cubre permitidos y rechazados", async () => {
      const filas: Fila[] = [];
      const detalle: Record<string, unknown> = {};
      let combinaciones = 0;
      let permitidas = 0;
      let rechazadas = 0;
      for (const p of personas) {
        for (const escenario of ESCENARIOS) {
          const e = p.juego.get(escenario);
          if (e === undefined) throw new Error("falta el escenario");
          for (const marca of MARCAS) {
            const contexto = contextoDe(e.empresa, p.id, marca);
            const viejo = await preguntar(antes, contexto, false);
            const nuevo = await preguntar(despues, contexto, true);
            combinaciones += 1;
            expect(
              nuevo,
              `${p.rol}/${p.membresia}/${p.persona}/${p.asignacion}/${escenario}/${marca}`,
            ).toEqual(viejo);
            detalle[
              `${p.rol}/${p.membresia}/${p.persona}/${p.asignacion}/${p.juego === juegos[0] ? "compartido" : "propio"}/${escenario}/${marca}`
            ] = normalizar(nuevo, e);
            if (viejo.permisos.ok) permitidas += 1;
            else rechazadas += 1;
            filas.push({
              rol: p.rol,
              membresia: p.membresia,
              persona: p.persona,
              asignacion: p.asignacion,
              escenario,
              marca,
              resumen: resumir(nuevo),
              completo: nuevo,
            });
          }
        }
      }
      expect(combinaciones).toBe(personas.length * ESCENARIOS.length * MARCAS.length);
      // La matriz no es trivial: hay combinaciones que pasan y combinaciones que se rechazan.
      expect(permitidas).toBeGreaterThan(20);
      expect(rechazadas).toBeGreaterThan(100);
      // Lo mismo, sin los ids al azar de cada corrida: sirve para comparar esta rama con `main` (la lectura de antes).
      const volcado = process.env["DECISIONES_EN_JSON"];
      if (volcado !== undefined && volcado !== "") {
        const ordenado = Object.fromEntries(
          Object.entries(detalle).sort(([x], [y]) => (x < y ? -1 : 1)),
        );
        writeFileSync(volcado, `${JSON.stringify(ordenado, null, 1)}\n`);
      }
      const destino = process.env["TABLA_DE_EQUIVALENCIA"];
      if (destino !== undefined && destino !== "") {
        const lineas = [
          "| Rol | Membresía | Persona | Asignación (operador) | Módulos de la empresa | Marca de entrada | Resultado (igual antes y después) |",
          "|---|---|---|---|---|---|---|",
          ...filas.map(
            (f) =>
              `| ${f.rol} | ${f.membresia} | ${f.persona} | ${f.asignacion} | ${f.escenario} | ${f.marca} | ${f.resumen} |`,
          ),
          "",
          `Combinaciones: ${combinaciones}. Permitidas (permisosDelActor ok): ${permitidas}. Rechazadas: ${rechazadas}. Diferencias antes/después: 0.`,
        ];
        writeFileSync(destino, `${lineas.join("\n")}\n`);
      }
    }, 600_000);

    it("las combinaciones clave: sin membresía, persona suspendida y marca ajena NO autorizan, en ambos caminos", async () => {
      const de = (rol: string, membresia: EstadoDeMembresia, persona: EstadoDePersona) => {
        const p = personas.find(
          (x) =>
            x.rol === rol &&
            x.membresia === membresia &&
            x.persona === persona &&
            (rol !== "OPERADOR" || x.asignacion === "ABIERTA"),
        );
        const e = p?.juego.get("ACTIVO");
        if (p === undefined || e === undefined) throw new Error("falta la persona de la matriz");
        return { id: p.id, empresa: e.empresa };
      };
      const gerente = de("GERENTE", "ACTIVA", "ACTIVA");
      const sinMembresia = de("GERENTE", "AJENA", "ACTIVA");
      const suspendida = de("GERENTE", "ACTIVA", "SUSPENDIDA");
      for (const compartir of [false, true]) {
        const entorno = compartir ? despues : antes;
        const pedir = (c: { id: string; empresa: string }, marca: Marca) =>
          preguntar(entorno, contextoDe(c.empresa, c.id, marca), compartir);
        expect((await pedir(gerente, "CORRECTA")).permisos.ok).toBe(true);
        expect((await pedir(sinMembresia, "CORRECTA")).permisos.ok).toBe(false);
        expect((await pedir(suspendida, "CORRECTA")).permisos.ok).toBe(false);
        expect((await pedir(gerente, "OTRA")).permisos.ok).toBe(false);
        expect((await pedir(gerente, "NINGUNA")).permisos.ok).toBe(false);
      }
    });

    it("un operador sin sucursal asignada no ve ninguna, con una asignada abierta ve solo esa (antes y después)", async () => {
      const operador = (asignacion: Asignacion) => {
        const p = personas.find(
          (x) =>
            x.rol === "OPERADOR" &&
            x.membresia === "ACTIVA" &&
            x.persona === "ACTIVA" &&
            x.asignacion === asignacion,
        );
        const e = p?.juego.get("ACTIVO");
        if (p === undefined || e === undefined) throw new Error("falta el operador de la matriz");
        return { id: p.id, empresa: e.empresa, sucursales: e.sucursales };
      };
      const sinAsignar = operador("NINGUNA");
      const conUna = operador("ABIERTA");
      for (const compartir of [false, true]) {
        const entorno = compartir ? despues : antes;
        const a = await preguntar(
          entorno,
          contextoDe(sinAsignar.empresa, sinAsignar.id, "CORRECTA"),
          compartir,
        );
        const b = await preguntar(
          entorno,
          contextoDe(conUna.empresa, conUna.id, "CORRECTA"),
          compartir,
        );
        expect(a.elegibles.ok && a.elegibles.valor.length).toBe(0);
        expect(b.elegibles.ok && b.elegibles.valor.map((x) => x.id)).toEqual([
          conUna.sucursales[0],
        ]);
      }
    });
  },
);
