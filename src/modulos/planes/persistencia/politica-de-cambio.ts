import { type Kysely, sql } from "kysely";
import { tenantId } from "../../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { deLaLista } from "./mapeos-de-planes";
import type { PlanesDePlataformaDb } from "./tablas";
import type { PoliticaGuardada, RepositorioDePlanes } from "./tipos-de-planes";

const SENTIDOS = ["SUBA", "BAJA"] as const;

/** Política de cambio de plan, sus condiciones por cambio y los arrepentimientos (migración 0087, solo inserción). */
export function crearPoliticaDeCambioDePlanes(
  db: Kysely<PlanesDePlataformaDb>,
): Pick<
  RepositorioDePlanes,
  | "politicasDeCambio"
  | "insertarPoliticaDeCambio"
  | "registrarCondicionesDeCambio"
  | "condicionesDeCambio"
  | "arrepentimientoDe"
  | "registrarArrepentimiento"
> {
  type Fila = Awaited<ReturnType<typeof leerPoliticas>>[number];
  const leerPoliticas = () =>
    db
      .selectFrom("politica_de_cambio_de_plan")
      .select([
        "version",
        "dias_de_anticipacion_de_suba",
        "dias_de_anticipacion_de_baja",
        "dias_de_arrepentimiento",
        "motivo",
        "definida_por",
        "creado_en",
      ])
      .orderBy("version", "asc")
      .execute();
  const aPolitica = (f: Fila): PoliticaGuardada => ({
    version: f.version,
    diasDeAnticipacionDeSuba: f.dias_de_anticipacion_de_suba,
    diasDeAnticipacionDeBaja: f.dias_de_anticipacion_de_baja,
    diasDeArrepentimiento: f.dias_de_arrepentimiento,
    motivo: f.motivo,
    definidaPor: f.definida_por,
    creadoEn: f.creado_en,
  });
  /** La `date` de Postgres como texto, para no pasar por una zona horaria: `to_char`. */
  const fechaCivil = (texto: string | null): FechaCivil | null => {
    if (texto === null) return null;
    const fecha = fechaCivilDesdeTexto(texto);
    if (!fecha.ok) throw new RangeError(`fecha civil guardada inválida: ${texto}`);
    return fecha.valor;
  };

  return {
    async politicasDeCambio() {
      return (await leerPoliticas()).map(aPolitica);
    },

    async insertarPoliticaDeCambio(nueva) {
      await db
        .insertInto("politica_de_cambio_de_plan")
        .values({
          version: nueva.version,
          dias_de_anticipacion_de_suba: nueva.diasDeAnticipacionDeSuba,
          dias_de_anticipacion_de_baja: nueva.diasDeAnticipacionDeBaja,
          dias_de_arrepentimiento: nueva.diasDeArrepentimiento,
          motivo: nueva.motivo,
          definida_por: sql<string>`(select app_actor_plataforma())`,
        })
        .execute();
      const fila = await db
        .selectFrom("politica_de_cambio_de_plan")
        .select([
          "version",
          "dias_de_anticipacion_de_suba",
          "dias_de_anticipacion_de_baja",
          "dias_de_arrepentimiento",
          "motivo",
          "definida_por",
          "creado_en",
        ])
        .where("version", "=", nueva.version)
        .executeTakeFirstOrThrow();
      return aPolitica(fila);
    },

    async registrarCondicionesDeCambio(c) {
      await db
        .insertInto("condiciones_de_cambio_de_plan")
        .values({
          tenant_id: c.tenantId,
          numero: c.numero,
          sentido: c.sentido,
          politica_version: c.politicaVersion,
          arrepentimiento_hasta: c.arrepentimientoHasta,
        })
        .execute();
    },

    async condicionesDeCambio(tenant, numero) {
      const f = await db
        .selectFrom("condiciones_de_cambio_de_plan")
        .select([
          "tenant_id",
          "numero",
          "sentido",
          "politica_version",
          sql<string | null>`to_char(arrepentimiento_hasta, 'YYYY-MM-DD')`.as("hasta"),
        ])
        .where("tenant_id", "=", tenant)
        .where("numero", "=", numero)
        .executeTakeFirst();
      return f === undefined
        ? null
        : {
            tenantId: tenantId(f.tenant_id),
            numero: f.numero,
            sentido: deLaLista(SENTIDOS, f.sentido, "sentido del cambio de plan"),
            politicaVersion: f.politica_version,
            arrepentimientoHasta: fechaCivil(f.hasta),
          };
    },

    async arrepentimientoDe(tenant, numero) {
      const f = await db
        .selectFrom("arrepentimiento_de_plan")
        .select(["numero_arrepentido", "numero_nuevo", "motivo", "registrado_por", "creado_en"])
        .where("tenant_id", "=", tenant)
        .where("numero_arrepentido", "=", numero)
        .executeTakeFirst();
      return f === undefined
        ? null
        : {
            tenantId: tenant,
            numeroArrepentido: f.numero_arrepentido,
            numeroNuevo: f.numero_nuevo,
            motivo: f.motivo,
            registradoPor: f.registrado_por,
            creadoEn: f.creado_en,
          };
    },

    async registrarArrepentimiento(a) {
      await db
        .insertInto("arrepentimiento_de_plan")
        .values({
          tenant_id: a.tenantId,
          numero_arrepentido: a.numeroArrepentido,
          numero_nuevo: a.numeroNuevo,
          motivo: a.motivo,
          registrado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .execute();
    },
  };
}
