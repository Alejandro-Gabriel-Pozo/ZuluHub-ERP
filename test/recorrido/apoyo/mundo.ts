import { randomBytes } from "node:crypto";
import { armarConexiones } from "../../../src/composicion/conexiones";
import { crearAlmacenDeTickets } from "../../../src/adaptadores/certificados/almacen-de-tickets";
import { emisorId, empresaId } from "../../../src/primitivas/identificadores/marca";
import { Secreto } from "../../../src/primitivas/secreto/secreto";
import type { BaseDePruebas } from "../../integracion/global";
import type { Escenario } from "../../integracion/facturacion-apoyo";
import { cargarCertificado } from "../../integracion/facturacion-casos-apoyo";
import { crearMembresiaDeBase } from "../../integracion/fixtures-identidad";
import {
  asignarPlan,
  crearDominio,
  crearMundoDeMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
} from "../../integracion/marcas-apoyo";
import {
  armarMundoWeb,
  ingresarEn,
  personaVinculada,
  type MundoWeb,
} from "../../integracion/web-apoyo";
import { levantarAppReal, type AppReal } from "./app-real";
import { levantarFachadaHttps, type FachadaHttps } from "./fachada-https";
import { levantarArcaSimulada, type ArcaSimulada } from "./arca-simulada";

/**
 * El mundo del recorrido: una base descartable con una marca (con su host de aplicación), una empresa que factura, una persona
 * que entró de verdad (por el proveedor local de Google, el mismo de las pruebas de integración), la ARCA de mentira y la app
 * REAL apuntando a todo eso. El ingreso no agrega ninguna puerta a la app: la sesión la crea la propia librería de ingreso, en
 * ESTE proceso, con el mismo secreto y la misma base que la app; la app solo la valida como a cualquier sesión.
 *
 * El host termina en `.localhost`: Chromium lo resuelve a 127.0.0.1 y lo trata como contexto seguro, así que las cookies
 * `__Host-` (Secure) funcionan sobre http sin tocar ni la app ni el navegador.
 */
export const HOST_DEL_RECORRIDO = "app.zulupan.localhost";

export type MundoDelRecorrido = Readonly<{
  app: AppReal;
  /** Por donde entra el navegador: https, con el host de la marca. */
  fachada: FachadaHttps;
  /** La dirección de la app para el navegador (sin barra final). */
  url: string;
  arca: ArcaSimulada;
  mundo: MundoWeb;
  /** Las cookies de la persona ya ingresada, listas para el contexto de Playwright. */
  cookies: ReadonlyArray<{
    name: string;
    value: string;
    domain: string;
    path: "/";
    httpOnly: true;
    secure: true;
  }>;
  empresa: string;
  cerrar(): Promise<void>;
}>;

export async function armarMundoDelRecorrido(base: BaseDePruebas): Promise<MundoDelRecorrido> {
  const mundo = await armarMundoWeb(base);
  const propia = mundo.propia.base;
  await crearVersionDeMarcaConfirmada(mundo.dueno, mundo.marcaA, { nombreVisible: "Zulú Pan" });
  await crearDominio(mundo.dueno, mundo.marcaA, { host: HOST_DEL_RECORRIDO, canonico: true });

  const claveDeCertificados = `recorrido-1:${randomBytes(32).toString("hex")}`;
  const entorno: Record<string, string> = {
    PEDERNAL_CLAVE_CONTEXTO: `${propia.clave.kid}:${propia.clave.secreto.toString("hex")}`,
    PEDERNAL_DB_APP: propia.app,
    PEDERNAL_DB_TRABAJOS: propia.trabajos,
    PEDERNAL_DB_PUBLICO: propia.publico,
    PEDERNAL_DB_AUTENTICACION: propia.autenticacion,
    PEDERNAL_AUTH_SECRETO_EMPRESA: mundo.auth.secreto,
    GOOGLE_CLIENT_ID: mundo.proveedor.clientId,
    GOOGLE_CLIENT_SECRET: mundo.proveedor.clientSecret,
    PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    PEDERNAL_CLAVE_CERTIFICADOS: claveDeCertificados,
    CRON_SECRET: randomBytes(24).toString("hex"),
  };

  // La persona entra de verdad y su empresa factura: datos fiscales confirmados, punto de venta y certificado de homologación.
  const yo = await ingresarEn(mundo, HOST_DEL_RECORRIDO);
  const persona = await personaVinculada(mundo, yo.sesion);
  const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA });
  await crearMembresiaDeBase(mundo.dueno, m.empresa, persona, "GERENTE");
  const { cuit } = (
    await mundo.dueno.query<{ cuit: string }>("select cuit from empresa where id = $1", [m.empresa])
  ).rows[0] as { cuit: string };
  const { id: emisor } = (
    await mundo.dueno.query<{ id: string }>(
      "select id from emisor where empresa_id = $1 and es_principal",
      [m.empresa],
    )
  ).rows[0] as { id: string };
  // La empresa nace SIN datos fiscales ni punto de venta: eso lo carga la persona en el recorrido. Lo único sembrado
  // es el certificado de homologación (cargarlo exige una cadena de ARCA real) y el ticket de más abajo.
  const e: Escenario = {
    tenant: m.tenant,
    empresa: m.empresa,
    cuit,
    sucursal: m.sucursal,
    persona,
    emisor,
    domicilio: "",
    datosFiscales: "",
    pv: "",
    pvNumero: 0,
    razonSocial: "",
    condicionIva: "RESPONSABLE_INSCRIPTO",
  };
  await cargarCertificado(propia, e, "HOMOLOGACION");
  const { version } = await crearPlanPublicado(mundo.dueno, { modulos: ["facturacion"] });
  await asignarPlan(mundo.dueno, m.tenant, version);
  await mundo.dueno.query(
    "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
    [m.empresa],
  );

  // Un ticket de acceso vigente, guardado como lo guarda la app (cifrado con su clave): así la emisión no pide `loginCms`
  // (firmaría con una clave privada real) y lo único que sale hacia ARCA es lo que simula `arca-simulada.ts`.
  const conexiones = armarConexiones({
    fuente: () => ({
      PEDERNAL_CLAVE_CONTEXTO: entorno["PEDERNAL_CLAVE_CONTEXTO"],
      PEDERNAL_DB_APP: propia.app,
      PEDERNAL_DB_TRABAJOS: propia.trabajos,
      PEDERNAL_CLAVE_CERTIFICADOS: claveDeCertificados,
    }),
  });
  try {
    const { rows } = await mundo.dueno.query<{ id: string }>(
      "select id from certificado_arca where empresa_id = $1 and emisor_id = $2 and estado = 'VIGENTE'",
      [e.empresa, e.emisor],
    );
    const certificado = rows[0]?.id;
    if (certificado === undefined) throw new Error("el escenario no dejó un certificado vigente");
    const ahora = new Date();
    const guardado = await crearAlmacenDeTickets({
      transacciones: conexiones.transaccionesDeApp(),
      cifrador: conexiones.cifradorDeCertificados(),
      reloj: { ahora: () => new Date() },
    }).guardar(empresaId(e.empresa), emisorId(e.emisor), "HOMOLOGACION", "wsfe", {
      certificadoId: certificado,
      token: new Secreto(randomBytes(24).toString("hex")),
      firma: new Secreto(randomBytes(24).toString("hex")),
      generadoEn: ahora,
      venceEn: new Date(ahora.getTime() + 11 * 3_600_000),
    });
    if (!guardado.ok)
      throw new Error(`no se pudo sembrar el ticket: ${JSON.stringify(guardado.error)}`);
  } finally {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
  }

  const arca = await levantarArcaSimulada();
  const app = await levantarAppReal(entorno, arca.puerto);
  const fachada = await levantarFachadaHttps(HOST_DEL_RECORRIDO, app.puerto);
  const cookies = yo.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((c) => ({
    name: c.nombre,
    value: c.valor,
    // `domain` sin punto inicial = cookie del host (sin atributo Domain), que es lo que exige el prefijo `__Host-`.
    domain: HOST_DEL_RECORRIDO,
    path: "/" as const,
    httpOnly: true as const,
    secure: true as const,
  }));
  return {
    app,
    fachada,
    url: `https://${HOST_DEL_RECORRIDO}:${fachada.puerto}`,
    arca,
    mundo,
    cookies,
    empresa: e.empresa,
    async cerrar() {
      await fachada.cerrar();
      await app.detener();
      await arca.cerrar();
      await mundo.cerrar();
    },
  };
}
