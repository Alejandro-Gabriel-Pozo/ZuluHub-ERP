import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { armarConexiones } from "../../src/composicion/conexiones";
import {
  listarComprobantes,
  listarPuntosDeVentaDeLaSucursal,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import { resolverEmpresa, type DependenciasDeSesion } from "../../src/composicion/sesion-y-empresa";
import { armarWeb } from "../../src/composicion/web";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { contarSentencias, type ContadorDeSentencias } from "./contar-sentencias";
import { crearMembresiaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import { HOST_A, armarMundoWeb, ingresarEn, personaVinculada, type MundoWeb } from "./web-apoyo";

/**
 * CUÁNTAS sentencias hace la base por un pedido. Hoy el listado de comprobantes cuesta 15 (2 de la persona y sus empresas, 8 del listado
 * y 5 de abrir y cerrar las dos transacciones); antes de "una vez por pedido" eran 47 (informe de medición, sección 3: 6 transacciones y
 * la misma pregunta de permisos hasta 7 veces). El tope falla si alguien vuelve a abrir una transacción por consulta o a leer los permisos
 * de nuevo en cada una. No cuenta la lectura de la sesión de la librería de ingreso (otro rol, medida aparte en el informe del PR).
 *
 * Reproduce el orden de `cargarElListado` y de la barra (`apps/web`): la persona y la empresa (puerta `SESION`), y en el mismo pedido las
 * sucursales que puede elegir, los puntos de venta, la página y los permisos de la barra.
 */

const base = inject("baseDePruebas");

/** Medido: 15. El margen es de 1; subirlo exige decir por qué en el PR. */
const TOPE_DEL_LISTADO = 16;

describe.skipIf(base === null)("sentencias por pedido: el listado de comprobantes", () => {
  let mundo: MundoWeb;
  let conexiones: ReturnType<typeof armarConexiones>;
  let web: ReturnType<typeof armarWeb>;
  let dependencias: DependenciasDeSesion;
  let dependenciasSinCompartir: DependenciasDeSesion;
  let dependenciasFiscales: DependenciasDeFacturacionWeb;
  let sesion: Awaited<ReturnType<typeof ingresarEn>>["sesion"];
  let contador: ContadorDeSentencias | null = null;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoWeb(base);
    const propia = mundo.propia.base;
    const yo = await ingresarEn(mundo, HOST_A);
    sesion = yo.sesion;
    const persona = await personaVinculada(mundo, yo.sesion);
    const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA });
    await crearMembresiaDeBase(mundo.dueno, m.empresa, persona, "GERENTE");
    const { version } = await crearPlanPublicado(mundo.dueno, { modulos: ["facturacion"] });
    await asignarPlan(mundo.dueno, m.tenant, version);
    await mundo.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [m.empresa],
    );
    conexiones = armarConexiones({
      fuente: () => ({
        PEDERNAL_CLAVE_CONTEXTO: `${propia.clave.kid}:${propia.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.app,
      }),
    });
    web = armarWeb(conexiones);
    dependenciasSinCompartir = {
      autenticacion: () => mundo.auth.autenticacion,
      consultasDeSesion: web.consultasDeSesion,
      casosDeUsoDeIdentidad: web.casosDeUsoDeIdentidad,
      consultasDeEmpresas: web.consultasDeEmpresas,
      ahora: () => new Date(),
      respuesta: { registrar: () => undefined },
    };
    dependencias = { ...dependenciasSinCompartir, lecturasCompartidas: web.lecturasCompartidas };
    dependenciasFiscales = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta: dependencias.respuesta,
    };
    contador = contarSentencias(mundo.dueno);
  });
  afterAll(async () => {
    contador?.detener();
    await conexiones.transaccionesDeApp().cerrar();
    await mundo.cerrar();
  });

  /** El pedido del listado, como lo arma `apps/web`: la entrada (persona y empresa) y, con ese contexto, lo que lee la pantalla y la barra. */
  async function pedidoDelListado(d: DependenciasDeSesion) {
    const entrada = await resolverEmpresa(d, {
      sesion,
      marcaId: mundo.marcaA,
      cookieDeEmpresa: null,
    });
    if (!entrada.ok || entrada.dato.tipo !== "ENTRA") throw new Error("el pedido no entró");
    const { contexto } = entrada.dato;
    const pantalla = async () => {
      const elegibles = await web.consultasDeEmpresas().sucursalesElegibles(contexto);
      const elegida = elegibles.ok ? (elegibles.valor.find((s) => s.activa)?.id ?? null) : null;
      const puntos = await listarPuntosDeVentaDeLaSucursal(
        dependenciasFiscales,
        contexto,
        elegida === null ? null : sucursalId(elegida),
      );
      const pagina = await listarComprobantes(
        dependenciasFiscales,
        contexto,
        elegida === null ? null : sucursalId(elegida),
        undefined,
      );
      const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
      return { elegibles, puntos, pagina, permisos };
    };
    const compartir = d.lecturasCompartidas?.();
    return compartir === undefined
      ? pantalla()
      : compartir.conLecturasCompartidas(contexto, pantalla);
  }

  it("el pedido del listado no pasa del tope y devuelve lo mismo que sin compartir", async () => {
    contador?.reiniciar();
    const con = await pedidoDelListado(dependencias);
    const cuantas = contador?.sentencias().length ?? 0;
    contador?.reiniciar();
    const sin = await pedidoDelListado(dependenciasSinCompartir);
    const sinCompartir = contador?.sentencias().length ?? 0;
    // Lo mismo, en lo que ve la persona.
    expect(con.pagina.ok).toBe(true);
    expect(con.permisos.ok && con.permisos.valor.acciones).toContain("comprobantes.ver");
    expect(JSON.stringify(con)).toEqual(JSON.stringify(sin));
    // Y mucho menos tráfico: el tope, y que la mejora es de compartir (sin compartir hay bastante más).
    expect(cuantas, `sentencias del pedido: ${cuantas}`).toBeLessThanOrEqual(TOPE_DEL_LISTADO);
    expect(sinCompartir).toBeGreaterThan(cuantas + 8);
  });

  it("una sola transacción de la empresa por pedido: un BEGIN para la persona y las empresas y un BEGIN para todo lo de la empresa", async () => {
    contador?.reiniciar();
    await pedidoDelListado(dependencias);
    const sentencias = contador?.sentencias() ?? [];
    const abiertas = sentencias.filter((s) => /^(begin|start transaction)/i.test(s)).length;
    expect(abiertas).toBe(2);
    // El rol de la membresía se lee una vez en todo el pedido (antes: 7).
    expect(sentencias.filter((s) => /from "membresia" as "m"/.test(s)).length).toBe(1);
  });
});
