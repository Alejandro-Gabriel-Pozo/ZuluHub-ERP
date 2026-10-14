import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "./ArmazonDeOperacion";
import { EsqueletoDePantalla } from "./EsqueletoDePantalla";
import { PantallaDeCuenta } from "./PantallaDeCuenta";
import { PantallaDeEleccionDeEmpresa } from "./PantallaDeEleccionDeEmpresa";
import { PantallaDeEstado } from "./PantallaDeEstado";
import { PantallaDeIngreso } from "./PantallaDeIngreso";
import { PantallaDeInicio } from "./PantallaDeInicio";
import { PantallaDeInvitacion } from "./PantallaDeInvitacion";
import { PantallaSinEmpresas } from "./PantallaSinEmpresas";
import type { EmpresaParaMostrar } from "./textos-de-empresa";

/**
 * P-8 sobre cada pantalla de sesión y empresa, en Chromium con el viewport del celular (390 x 844): axe sin
 * violaciones como página, aria snapshots de ingreso, elegir empresa, errores y estados, y los criterios de
 * legibilidad del dueño (D4/D10): nada de letra por debajo de 16 px, objetivos táctiles de 48 px o más, nada
 * que desborde hacia el costado, `lang="es-AR"` en el documento de la aplicación (se prueba en el layout raíz).
 */
const accionVacia = () => Promise.resolve({ error: null });

const empresa = (
  nombre: string,
  rol: EmpresaParaMostrar["rol"] = "GERENTE",
  estadoEfectivo: EmpresaParaMostrar["estadoEfectivo"] = "OPERA",
): EmpresaParaMostrar => ({ empresaId: `id-${nombre}`, nombre, rol, estadoEfectivo });

/** Cada texto visible llega a 16 px, cada control a 48 px de alto y la página no se corre hacia el costado. */
function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16)
      chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent?.slice(0, 30)}`);
  }
  expect(chicos).toEqual([]);

  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden])",
  )) {
    if (el.closest("[hidden]") !== null || el.getClientRects().length === 0) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48)
      bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent?.slice(0, 30)}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

async function verificar(pantalla: ReactNode): Promise<void> {
  await render(pantalla);
  expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  legibleYTocable();
}

describe("ingreso", () => {
  const ingreso = (codigoDeError: string | null = null) => (
    <PantallaDeIngreso
      marca="Hotel del Lago"
      accion={accionVacia}
      volver="/"
      codigoDeError={codigoDeError}
    />
  );

  it("sin error: sin violaciones, legible y tocable; aria snapshot", async () => {
    const { container } = await render(ingreso());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Ingresá a Hotel del Lago" [level=1]
        - paragraph: Usá tu cuenta de Google para entrar.
        - button "Ingresar con Google"
    `);
  });

  it("con cada error de la lista cerrada: el texto traducido, nunca el código", async () => {
    await verificar(ingreso("access_denied"));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Cancelaste el ingreso con Google. Podés volver a intentarlo.");
  });

  it("con un error y snapshot", async () => {
    const { container } = await render(ingreso("state_mismatch"));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Ingresá a Hotel del Lago" [level=1]
        - paragraph: Usá tu cuenta de Google para entrar.
        - alert:
          - paragraph: El ingreso se interrumpió. Probá de nuevo.
        - button "Ingresar con Google"
    `);
  });

  it("el botón es de ancho completo y dice el verbo", async () => {
    await render(ingreso());
    const boton = page.getByRole("button", { name: "Ingresar con Google" });
    await expect.element(boton).toBeVisible();
    const ancho = boton.element().getBoundingClientRect().width;
    expect(ancho).toBeGreaterThan(250);
  });
});

describe("invitación", () => {
  it("sin enlace", async () => {
    await verificar(<PantallaDeInvitacion estado="SIN_ENLACE" marca="Hotel del Lago" />);
    await expect.element(page.getByText(/Falta el enlace de la invitación/)).toBeVisible();
  });

  it("sin sesión: primero Google, con el token solo en un campo oculto", async () => {
    await verificar(
      <PantallaDeInvitacion
        estado="SIN_SESION"
        marca="Hotel del Lago"
        token="tok"
        accionDeIngreso={accionVacia}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  });

  it("con sesión: aceptar", async () => {
    await verificar(
      <PantallaDeInvitacion
        estado="CON_SESION"
        marca="Hotel del Lago"
        aceptar={() => Promise.resolve({ ok: true, dato: { yaEstabaAceptada: false } })}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Aceptar invitación" })).toBeVisible();
  });
});

describe("elegir empresa", () => {
  const dos = [
    empresa("Café del Puerto"),
    empresa("Panadería Los Pinos", "OPERADOR", "EMPRESA_SUSPENDIDA"),
  ];

  it("la lista con su rol y, si no opera, por qué; sin violaciones; aria snapshot", async () => {
    const { container } = await render(
      <PantallaDeEleccionDeEmpresa empresas={dos} accion={accionVacia} />,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.getByText("La empresa está suspendida.")).toBeVisible();
    expect(page.getByRole("button", { name: /^Entrar a la empresa/ }).elements()).toHaveLength(2);
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Elegí la empresa" [level=1]
        - paragraph: Con cuál querés trabajar ahora.
        - list:
          - listitem:
            - paragraph: Café del Puerto
            - text: Gerente
            - button "Entrar a la empresa Café del Puerto"
          - listitem:
            - paragraph: Panadería Los Pinos
            - text: Operador La empresa está suspendida.
            - button "Entrar a la empresa Panadería Los Pinos"
    `);
  });

  it("un nombre largo no desborda el celular", async () => {
    await verificar(
      <PantallaDeEleccionDeEmpresa
        empresas={[
          empresa("Confitería y Panificadora Artesanal de las Sierras Centrales Sociedad Anónima"),
        ]}
        accion={accionVacia}
      />,
    );
  });

  it("el nombre se decide mirando: 18 px o más (D4)", async () => {
    await render(<PantallaDeEleccionDeEmpresa empresas={dos} accion={accionVacia} />);
    const nombre = page.getByText("Café del Puerto", { exact: true }).first().element();
    expect(Number.parseFloat(getComputedStyle(nombre).fontSize)).toBeGreaterThanOrEqual(18);
  });

  it("sin empresas: el texto de la marca y la salida para entrar con otra cuenta", async () => {
    const { container } = await render(
      <PantallaSinEmpresas marca="Hotel del Lago" accionDeCerrarSesion={accionVacia} />,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect
      .element(
        page.getByText(
          "No tenés empresas en Hotel del Lago. Si te invitaron, abrí el enlace del mail.",
        ),
      )
      .toBeVisible();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Sin empresas" [level=1]
        - status:
          - paragraph: No tenés empresas en Hotel del Lago. Si te invitaron, abrí el enlace del mail.
        - button "Cerrar sesión"
    `);
  });
});

describe("estados", () => {
  it("no encontrado, con la salida al inicio; aria snapshot (neutra)", async () => {
    const { container } = await render(
      <PantallaDeEstado
        titulo={texto({}, "estado.no_encontrado_titulo")}
        detalle={texto({}, "estado.no_encontrado_detalle")}
      >
        <EnlaceDeAccion href="/">{texto({}, "estado.volver_al_inicio")}</EnlaceDeAccion>
      </PantallaDeEstado>,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "No encontrado" [level=1]
        - paragraph: La página que buscás no existe.
        - link "Volver al inicio":
          - /url: /
    `);
  });

  it("mantenimiento", async () => {
    await verificar(
      <PantallaDeEstado
        titulo={texto({}, "estado.mantenimiento_titulo")}
        detalle={texto({}, "estado.mantenimiento_detalle")}
      >
        <ErrorDeRespuesta
          error={{ ...errorDeCodigo("NO_DISPONIBLE"), referencia: "ZH-ABCD-0123" }}
          accion={<EnlaceDeAccion href="/">{texto({}, "estado.reintentar")}</EnlaceDeAccion>}
        />
      </PantallaDeEstado>,
    );
  });

  it("sin permiso: el motivo traducido con su código, y cambiar de empresa; aria snapshot", async () => {
    const { container } = await render(
      <PantallaDeEstado titulo={texto({}, "estado.sin_permiso_titulo")}>
        <ErrorDeRespuesta
          error={errorDeCodigo("SIN_PERMISO")}
          accion={<EnlaceDeAccion href="/empresa">{texto({}, "empresa.cambiar")}</EnlaceDeAccion>}
        />
      </PantallaDeEstado>,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Sin permiso" [level=1]
        - status:
          - paragraph: No tiene permiso para hacer esto.
          - paragraph:
            - code: SIN_PERMISO
          - link "Cambiar de empresa":
            - /url: /empresa
    `);
  });

  it("error inesperado: con referencia y reintentar; aria snapshot", async () => {
    const { container } = await render(
      <PantallaDeEstado titulo={texto({}, "estado.error_titulo")}>
        <ErrorDeRespuesta
          error={{ ...errorDeCodigo("ERROR_INTERNO"), referencia: "ZH-ABCD-0123" }}
          accion={<EnlaceDeAccion href="/">{texto({}, "estado.reintentar")}</EnlaceDeAccion>}
        />
      </PantallaDeEstado>,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Algo salió mal" [level=1]
        - alert:
          - paragraph: "No se pudo completar. Podés reintentar: es seguro, no se duplica."
          - paragraph: "Referencia: ZH-ABCD-0123"
          - link "Reintentar":
            - /url: /
    `);
  });

  it("cargando: el esqueleto se anuncia como región ocupada y no bloquea nada", async () => {
    await verificar(<EsqueletoDePantalla />);
    await expect.element(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
    await expect.element(page.getByRole("status")).toHaveTextContent("Cargando…");
  });
});

describe("armazón de operación", () => {
  const armazon = (
    hijos: ReactNode,
    modulos: Parameters<typeof ArmazonDeOperacion>[0]["modulos"] = [],
  ) => (
    <ArmazonDeOperacion
      titulo="Inicio"
      actual="inicio"
      marca="Hotel del Lago"
      empresa="Café del Puerto"
      modulos={modulos}
    >
      {hijos}
    </ArmazonDeOperacion>
  );

  it("inicio con la ranura «lo que falta» vacía: sin violaciones, legible, tocable; aria snapshot", async () => {
    const { container } = await render(
      armazon(<PantallaDeInicio empresa={empresa("Café del Puerto")} pendientes={[]} />),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.getByText("No hay nada pendiente por ahora.")).toBeVisible();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - link "Saltar al contenido":
        - /url: "#contenido"
      - banner:
        - paragraph: Hotel del Lago
        - paragraph: Café del Puerto
        - link "Cambiar de empresa":
          - /url: /empresa
        - text: Sesión activa
        - heading "Inicio" [level=1]
      - main:
        - paragraph: Estás en Café del Puerto.
        - region "Lo que falta":
          - heading "Lo que falta" [level=2]
          - paragraph: No hay nada pendiente por ahora.
      - contentinfo:
        - navigation "Navegación principal":
          - list:
            - listitem:
              - link "Inicio":
                - /url: /
            - listitem:
              - link "Empresa":
                - /url: /empresa
            - listitem:
              - link "Cuenta":
                - /url: /cuenta
    `);
  });

  it("con pendientes de un módulo y una empresa que no opera", async () => {
    await verificar(
      armazon(
        <PantallaDeInicio
          empresa={empresa("Café del Puerto", "GERENTE", "EMPRESA_EN_ALTA")}
          pendientes={[
            {
              id: "datos",
              titulo: "Cargar los datos fiscales",
              detalle: "Sin esto no se puede facturar",
              href: "/fiscal",
            },
            { id: "pv", titulo: "Elegir el punto de venta", href: "/fiscal/puntos" },
          ]}
        />,
      ),
    );
    await expect
      .element(page.getByText("La empresa todavía no terminó de darse de alta."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: /Cargar los datos fiscales/ }))
      .toBeVisible();
  });

  it("la barra superior: marca, empresa, cambio de empresa y estado de la sesión", async () => {
    await render(armazon(<p>Contenido</p>));
    await expect.element(page.getByText("Hotel del Lago")).toBeVisible();
    await expect.element(page.getByText("Café del Puerto")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Cambiar de empresa" }))
      .toHaveAttribute("href", "/empresa");
    await expect.element(page.getByText("Sesión activa")).toBeVisible();
    // Un solo encabezado de página (banner): la barra va dentro del encabezado de la plantilla.
    expect(page.getByRole("banner").elements()).toHaveLength(1);
  });

  it("la barra inferior: sin módulos, inicio, empresa y cuenta; con módulos, hasta cinco destinos", async () => {
    const { unmount } = await render(armazon(<p>Contenido</p>));
    const nav = () => page.getByRole("navigation", { name: "Navegación principal" });
    expect(
      nav()
        .getByRole("link")
        .elements()
        .map((e) => e.textContent),
    ).toEqual(["Inicio", "Empresa", "Cuenta"]);
    await expect
      .element(nav().getByRole("link", { name: "Inicio" }))
      .toHaveAttribute("aria-current", "page");
    await unmount();
    const modulo = (n: string) => ({ href: `/${n}`, etiqueta: n, icono: "cuenta" as const });
    for (const [modulos, esperados] of [
      [[modulo("Ventas")], 3],
      [[modulo("Ventas"), modulo("Caja")], 4],
      [[modulo("Ventas"), modulo("Caja"), modulo("Stock"), modulo("Agenda")], 5],
    ] as const) {
      const r = await render(armazon(<p>Contenido</p>, modulos));
      expect(nav().getByRole("link").elements()).toHaveLength(esperados);
      legibleYTocable();
      await r.unmount();
    }
  });

  it("cuenta: empresa, rol, sucursal y cerrar sesión", async () => {
    await verificar(
      <ArmazonDeOperacion
        titulo="Cuenta"
        actual="cuenta"
        marca="Hotel del Lago"
        empresa="Café del Puerto"
      >
        <PantallaDeCuenta
          empresa={empresa("Café del Puerto")}
          sucursales={[
            { id: "s1", nombre: "Casa central" },
            { id: "s2", nombre: "Sucursal Norte" },
          ]}
          accionDeCerrarSesion={accionVacia}
        />
      </ArmazonDeOperacion>,
    );
    await expect.element(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect.element(page.getByRole("combobox", { name: "Sucursal" })).toBeVisible();
  });
});
