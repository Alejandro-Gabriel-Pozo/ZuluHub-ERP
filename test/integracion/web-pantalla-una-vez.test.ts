import { ENCABEZADO_DE_IP } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import { ipUnica } from "./autenticacion-ingreso-apoyo";
import { contarSentencias, type ContadorDeSentencias } from "./contar-sentencias";
import {
  HOST_A,
  armarMundoWeb,
  empresaDeLaMarca,
  ingresarEn,
  personaVinculada,
  type MundoWeb,
} from "./web-apoyo";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * El CABLEADO de la pantalla, por la ruta real: la página de Cuenta pasa por `pantallaDeOperacion` (`apps/web/pantallas/operacion.tsx`) y por
 * `dependenciasDeSesion` (`apps/web/servidor/sesion.ts`), sin reimplementar el armado. Si alguien quita `conLecturasCompartidas` de la pantalla
 * o `lecturasCompartidas` de las dependencias, el pedido vuelve a abrir una transacción por consulta y esta prueba falla. Next se reemplaza
 * por lo mínimo (encabezados, cookies, redirecciones), como en `web-acciones.test.ts`.
 */
vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  mundo: null as MundoWeb | null,
  encabezados: new Headers(),
  jar: new Map<string, string>(),
  conLecturasCompartidas: true,
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(estado.encabezados),
  cookies: () =>
    Promise.resolve({
      get: (nombre: string) => {
        const valor = estado.jar.get(nombre);
        return valor === undefined ? undefined : { name: nombre, value: valor };
      },
      set: (nombre: string, valor: string) => {
        estado.jar.set(nombre, valor);
      },
      delete: (nombre: string) => {
        estado.jar.delete(nombre);
      },
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    autenticacion: () => estado.mundo?.dependencias.autenticacion(),
    consultasDeSesion: () => estado.mundo?.dependencias.consultasDeSesion(),
    casosDeUsoDeIdentidad: () => estado.mundo?.dependencias.casosDeUsoDeIdentidad(),
    consultasDeEmpresas: () => estado.mundo?.dependencias.consultasDeEmpresas(),
    // Con `false` simula que el cableado se quitó: la pantalla cae al camino de siempre.
    lecturasCompartidas: () =>
      estado.conLecturasCompartidas
        ? estado.mundo?.dependencias.lecturasCompartidas?.()
        : undefined,
  },
}));
vi.mock("../../apps/web/servidor/fuente-de-puertas", () => ({
  fuenteDePuertas: {
    consultarHost: (host: string, superficie: string) => {
      const m = estado.mundo;
      if (m === null || superficie !== "APP" || host !== HOST_A) return Promise.resolve(ok(null));
      return Promise.resolve(ok({ marcaId: m.marcaA }));
    },
    leerMarca: () => Promise.resolve({ nombre: "Hotel del Lago", tema: {}, hostDeApp: null }),
  },
}));

type Pagina = () => unknown;
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ ruta) as Promise<{ default: Pagina }>;

const base = inject("baseDePruebas");
const LECTURA = /^start transaction isolation level read committed read only/i;

describe.skipIf(base === null)(
  "la pantalla comparte las lecturas del pedido (cableado real)",
  () => {
    let mundo: MundoWeb;
    let contador: ContadorDeSentencias | null = null;

    beforeAll(async () => {
      if (base === null) return;
      vi.stubEnv("VERCEL_ENV", "preview");
      mundo = await armarMundoWeb(base);
      estado.mundo = mundo;
      contador = contarSentencias(mundo.dueno);
    });
    afterAll(async () => {
      contador?.detener();
      await mundo.cerrar();
      estado.mundo = null;
      vi.unstubAllEnvs();
    });

    async function transaccionesDeLecturaDeUnaCuenta(compartir: boolean): Promise<number> {
      estado.conLecturasCompartidas = compartir;
      const { default: Cuenta } = await cargar("../../apps/web/app/s/app/(operacion)/cuenta/page");
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      estado.jar.clear();
      for (const c of yo.navegador.cookiesDe(HOST_A))
        estado.jar.set(c.nombre, decodeURIComponent(c.valor));
      const cookies = [...estado.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
      estado.encabezados = new Headers({
        host: HOST_A,
        [ENCABEZADO_DE_IP]: ipUnica(),
        cookie: cookies,
      });
      contador?.reiniciar();
      const pagina = renderToStaticMarkup((await Cuenta()) as ReactNode);
      expect(pagina).toContain("Cerrar sesión");
      return (contador?.sentencias() ?? []).filter((s) => LECTURA.test(s)).length;
    }

    it("con el cableado: la persona y sus empresas en una transacción y todo lo de la empresa en otra (2 en total)", async () => {
      expect(await transaccionesDeLecturaDeUnaCuenta(true)).toBe(2);
    });

    it("inyección: sin el cableado de la pantalla el mismo pedido abre una transacción por consulta (la prueba de arriba lo detectaría)", async () => {
      expect(await transaccionesDeLecturaDeUnaCuenta(false)).toBeGreaterThan(2);
    });
  },
);
