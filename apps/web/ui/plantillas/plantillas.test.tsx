import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { Aviso } from "../componentes/Aviso";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { PlantillaAdministracion } from "./PlantillaAdministracion";
import { PlantillaNeutra } from "./PlantillaNeutra";
import { PlantillaOperacion, type DestinoDeOperacion } from "./PlantillaOperacion";

// Íconos de prueba: las plantillas no conocen ninguna pantalla; cada módulo trae sus destinos reales.
const destino = (
  etiqueta: string,
  icono: DestinoDeOperacion["icono"],
  actual = false,
): DestinoDeOperacion => ({
  etiqueta,
  icono,
  href: `/${etiqueta.toLowerCase()}`,
  actual,
});
const tres = [
  destino("Uno", "reloj", true),
  destino("Dos", "estado-info"),
  destino("Tres", "sin-conexion"),
] as const;

function sinDesbordeHorizontal(): boolean {
  return document.documentElement.scrollWidth <= window.innerWidth;
}

describe("PlantillaOperacion (mostrador en el celular)", () => {
  const armar = (destinos = tres) => (
    <PlantillaOperacion
      titulo="Mostrador"
      etiquetaDeNavegacion="Navegación principal"
      textoDeSalto="Saltar al contenido"
      destinos={destinos}
      barraDeAccion={<p>Barra de acción</p>}
    >
      <p>Contenido</p>
    </PlantillaOperacion>
  );

  it("sin violaciones de accesibilidad como página (landmarks, un h1, contraste)", async () => {
    await render(armar());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("aria snapshot: salto, título, contenido y navegación con el destino actual", async () => {
    const { container } = await render(armar());
    await expect.element(page.getByRole("main")).toBeVisible();
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - link "Saltar al contenido":
        - /url: #contenido
      - banner:
        - heading "Mostrador" [level=1]
      - main:
        - paragraph: Contenido
      - contentinfo:
        - paragraph: Barra de acción
        - navigation "Navegación principal":
          - list:
            - listitem:
              - link "Uno":
                - /url: /uno
            - listitem:
              - link "Dos":
                - /url: /dos
            - listitem:
              - link "Tres":
                - /url: /tres
    `);
  });

  it("la barra inferior ofrece 3, 4 o 5 destinos con texto además del ícono", async () => {
    const cuatro = [...tres, destino("Cuatro", "cerrar")] as const;
    const cinco = [...cuatro, destino("Cinco", "reloj")] as const;
    for (const destinos of [tres, cuatro, cinco]) {
      const { unmount } = await render(armar(destinos as typeof tres));
      const enlaces = page
        .getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link");
      expect(enlaces.elements()).toHaveLength(destinos.length);
      for (const enlace of enlaces.elements()) expect(enlace.textContent?.trim()).not.toBe("");
      expect(sinDesbordeHorizontal()).toBe(true);
      await unmount();
    }
  });

  it("menos de 3 o más de 5 destinos no compila", () => {
    const base = { titulo: "T", etiquetaDeNavegacion: "N", textoDeSalto: "S", children: null };
    // @ts-expect-error con dos destinos no hay barra: son de 3 a 5
    const pocos = <PlantillaOperacion {...base} destinos={[tres[0], tres[1]]} />;
    const seis = [...tres, ...tres] as const;
    // @ts-expect-error con seis destinos tampoco
    const muchos = <PlantillaOperacion {...base} destinos={seis} />;
    expect([pocos, muchos]).toHaveLength(2);
  });

  it("el destino actual se marca; cada destino llega a 48 px de alto", async () => {
    await render(armar());
    await expect
      .element(page.getByRole("link", { name: "Uno" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "Dos" }))
      .not.toHaveAttribute("aria-current");
    for (const enlace of page.getByRole("navigation").getByRole("link").elements()) {
      expect(enlace.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
  });

  it("el primer Tab llega al enlace de salto, y saltar lleva al contenido", async () => {
    await render(armar());
    await userEvent.keyboard("{Tab}");
    const salto = page.getByRole("link", { name: "Saltar al contenido" });
    expect(document.activeElement).toBe(salto.element());
    await expect.element(salto).toBeVisible();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(page.getByRole("main").element());
  });

  it("la barra inferior queda pegada abajo aunque haya poco contenido", async () => {
    await render(armar());
    const barra = page.getByRole("navigation").element().getBoundingClientRect();
    expect(Math.round(barra.bottom)).toBe(window.innerHeight);
  });

  it("acepta franjas arriba (conexión, solo lectura)", async () => {
    await render(
      <PlantillaOperacion
        titulo="Mostrador"
        etiquetaDeNavegacion="Navegación principal"
        textoDeSalto="Saltar"
        destinos={tres}
        franjas={<Aviso tono="aviso">Módulo en solo lectura.</Aviso>}
      >
        <p>Contenido</p>
      </PlantillaOperacion>,
    );
    await expect.element(page.getByRole("status")).toHaveTextContent("Módulo en solo lectura.");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});

describe("PlantillaAdministracion", () => {
  const armar = () => (
    <PlantillaAdministracion
      titulo="Administración"
      etiquetaDeNavegacion="Secciones"
      textoDeSalto="Saltar al contenido"
      secciones={[
        { etiqueta: "Empresa", href: "/empresa", actual: true },
        { etiqueta: "Equipo", href: "/equipo" },
      ]}
    >
      <p>Contenido</p>
    </PlantillaAdministracion>
  );

  it("sin violaciones como página y con su snapshot", async () => {
    const { container } = await render(armar());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - link "Saltar al contenido":
        - /url: "#contenido"
      - banner:
        - heading "Administración" [level=1]
      - navigation "Secciones":
        - list:
          - listitem:
            - link "Empresa":
              - /url: /empresa
          - listitem:
            - link "Equipo":
              - /url: /equipo
      - main:
        - paragraph: Contenido
    `);
    expect(sinDesbordeHorizontal()).toBe(true);
  });

  it("es más compacta que el mostrador, sin bajar de 44 px de toque", async () => {
    await render(armar());
    for (const enlace of page.getByRole("navigation").getByRole("link").elements()) {
      const alto = enlace.getBoundingClientRect().height;
      expect(alto).toBeGreaterThanOrEqual(44);
      expect(alto).toBeLessThan(48);
    }
    await expect
      .element(page.getByRole("link", { name: "Empresa" }))
      .toHaveAttribute("aria-current", "page");
  });
});

describe("PlantillaNeutra", () => {
  it("una tarjeta con título: sin violaciones como página y con su snapshot", async () => {
    const { container } = await render(
      <PlantillaNeutra titulo="Página no disponible">
        <p>Probá desde el enlace que te dieron.</p>
      </PlantillaNeutra>,
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.elementLocator(container)).toMatchAriaInlineSnapshot(`
      - main:
        - heading "Página no disponible" [level=1]
        - paragraph: Probá desde el enlace que te dieron.
    `);
    expect(sinDesbordeHorizontal()).toBe(true);
  });

  it("no escribe ningún nombre ni color de marca: usa los tokens neutros", () => {
    const fuentes = import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true });
    for (const [archivo, texto] of Object.entries(fuentes)) {
      if (archivo.endsWith(".test.tsx")) continue;
      expect(texto as string, archivo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
