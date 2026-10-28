import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { CLAVE_DE_LETRA_GUARDADA } from "../../../../../src/capacidades/experiencia/vidriera/letra";
import type { VistaDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PlantillaDeVidriera } from "./PlantillaDeVidriera.cliente";
import {
  CAFE_HELADO,
  CAPUCHINO,
  CON_FOTO,
  LARGO,
  MILANESA,
  NOQUIS,
  SIN_NADA,
  TEXTOS,
  vidrieraDePrueba,
  fotoDePrueba,
  productoDePrueba,
} from "./datosDePrueba";

const URL_INICIAL = window.location.href;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", URL_INICIAL);
  document.documentElement.style.fontSize = "";
  Reflect.deleteProperty(navigator, "share");
});

async function abrirVidriera(vista: VistaDeVidriera = vidrieraDePrueba()) {
  const pantalla = await render(<PlantillaDeVidriera vista={vista} textos={TEXTOS} />);
  // El control «Letra» aparece al hidratar.
  await expect.element(page.getByRole("button", { name: "Letra normal" })).toBeVisible();
  return pantalla;
}

const px = (el: Element, propiedad: "fontSize" | "lineHeight" = "fontSize"): number =>
  parseFloat(getComputedStyle(el)[propiedad]);

function enlaceDe(nombre: string): HTMLAnchorElement {
  const el = [...document.querySelectorAll<HTMLAnchorElement>("a[data-segmento]")].find(
    (a) => a.children[0]?.textContent?.startsWith(nombre) === true,
  );
  if (el === undefined) throw new Error(`no hay un ítem ${nombre}`);
  return el;
}

/** Los dos elementos de la fila de un ítem: nombre y precio. */
function nombreYPrecio(enlace: HTMLElement): [HTMLElement, HTMLElement] {
  return [
    enlace.querySelector<HTMLElement>('[class*="nombre"]') as HTMLElement,
    enlace.querySelector<HTMLElement>('[class*="precio"]') as HTMLElement,
  ];
}

/** Todo elemento que tiene texto propio (no el de sus hijos). */
function conTexto(raiz: ParentNode): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>("*")].filter((el) =>
    [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    ),
  );
}

const elegirLetra = async (nombre: "Letra normal" | "Letra grande" | "Letra muy grande") => {
  await userEvent.click(page.getByRole("button", { name: nombre }));
};

describe("carta: accesibilidad y estructura (C-4, D9)", () => {
  it("sin violaciones de axe (contraste incluido), con la tarjeta cerrada y abierta", async () => {
    await abrirVidriera();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await userEvent.click(page.getByRole("link", { name: /^Capuchino desde/ }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    // Axe mide el color pintado: se espera a que la hoja termine de subir (opacidad plena).
    await vi.waitFor(() => {
      expect(getComputedStyle(document.querySelector("dialog") as Element).opacity).toBe("1");
    });
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("sin violaciones con «muy grande» y con la letra base grande", async () => {
    await abrirVidriera(vidrieraDePrueba({ letraBase: "GRANDE" }));
    await elegirLetra("Letra muy grande");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("un main, un h1 con el nombre, un h2 por sección y una ul por sección", async () => {
    const vista = vidrieraDePrueba();
    await abrirVidriera(vista);
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(page.getByRole("heading", { level: 1 }).element().textContent).toBe("La Esquina Café");
    const h2 = [...document.querySelectorAll("section > h2")].map((h) => h.textContent);
    expect(h2).toEqual(vista.secciones.map((s) => s.nombre));
    expect(document.querySelectorAll("section > ul")).toHaveLength(vista.secciones.length);
  });

  it("cada ítem es un enlace «{nombre} {precio} {Agotado}» y lo demás lo describe", async () => {
    await abrirVidriera();
    await expect.element(page.getByRole("link", { name: "Capuchino desde $ 3.300" })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Café helado desde $ 3.900 Agotado" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Capuchino desde $ 3.300" }))
      .toHaveAccessibleDescription("Espresso, leche espumada y cacao amargo.");
    await expect
      .element(page.getByRole("link", { name: "Sándwich de milanesa $ 8.600" }))
      .toHaveAccessibleDescription(
        "Milanesa de ternera, lechuga, tomate y mayonesa casera. Con papas fritas, puré o ensalada",
      );
  });

  it("aria snapshot de la primera sección", async () => {
    await abrirVidriera(vidrieraDePrueba({ cantidad: 8 }));
    await expect.element(page.getByRole("region", { name: "Cafés" })).toMatchAriaInlineSnapshot(`
      - region "Cafés":
        - heading "Cafés" [level=2]
        - list:
          - listitem:
            - link "Capuchino desde $ 3.300":
              - /url: /ejemplo/capuchino-9e37a9ea
            - text: Espresso, leche espumada y cacao amargo.
          - listitem:
            - link "Café helado desde $ 3.900 Agotado":
              - /url: /ejemplo/cafe-helado-3c6f239b
    `);
  });
});

describe("carta: producto sin foto, sin descripción, agotado y con foto (C-7)", () => {
  it("el agotado lleva el texto «Agotado» y no se mueve de su lugar", async () => {
    const vista = vidrieraDePrueba();
    await abrirVidriera(vista);
    const nombres = [...document.querySelectorAll("a[data-segmento]")].map((a) =>
      a.getAttribute("data-segmento"),
    );
    expect(nombres.indexOf(CAFE_HELADO.segmento)).toBe(1);
    expect(enlaceDe("Café helado").textContent).toContain("Agotado");
  });

  it("sin foto no hay imagen; con foto, miniatura decorativa con width, height y caja de 72 x 54", async () => {
    await abrirVidriera();
    expect(enlaceDe("Medialuna").closest("li")?.querySelector("img")).toBeNull();
    const img = enlaceDe("Torta rogel").closest("li")?.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("width")).toBe("480");
    expect(img?.getAttribute("height")).toBe("360");
    const caja = img?.parentElement?.getBoundingClientRect();
    expect(caja?.width).toBe(72);
    expect(caja?.height).toBe(54);
  });

  it("todo ítem se toca igual: uno sin foto, sin descripción y sin adicionales abre su tarjeta", async () => {
    await abrirVidriera();
    await userEvent.click(enlaceDe("Medialuna"));
    const dialogo = page.getByRole("dialog", { name: "Medialuna" });
    await expect.element(dialogo).toBeVisible();
    expect(dialogo.element().querySelector("img")).toBeNull();
    expect(dialogo.element().textContent).not.toContain("Sin descripción");
    expect(dialogo.element().textContent).toContain("$ 900");
  });

  it("la tarjeta muestra tamaños, descripción con sus saltos, adicionales con «+ $» y la foto con su alt", async () => {
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    const t = page.getByRole("dialog", { name: "Capuchino" }).element();
    expect(t.textContent).toContain("Mediano$ 3.700");
    expect(t.textContent).toContain("Leche de almendras+ $ 600");
    expect(t.textContent).toContain("Crema");
    expect(t.textContent).not.toContain("Crema+");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
    await userEvent.click(enlaceDe("Torta rogel"));
    const foto = document.querySelector("dialog img");
    expect(foto?.getAttribute("alt")).toBe("Torta rogel con dulce de leche");
    expect(foto?.getAttribute("width")).toBe("480");
  });

  it("una foto que falla deja la caja con su tamaño y sin imagen rota", async () => {
    const rota = productoDePrueba("Pan rústico", 50, {
      foto: { ...fotoDePrueba(), direccion: "/no-existe-nunca.webp" },
    });
    const base = vidrieraDePrueba({ cantidad: 7 });
    const vista: VistaDeVidriera = {
      ...base,
      secciones: [
        {
          id: "cafes",
          nombre: "Cafés",
          productos: [rota, ...(base.secciones[0]?.productos ?? [])],
        },
      ],
    };
    await abrirVidriera(vista);
    await vi.waitFor(() => {
      const caja = enlaceDe("Pan rústico").closest("li")?.querySelector("[data-estado]");
      expect(caja?.getAttribute("data-estado")).toBe("rota");
    });
    const caja = enlaceDe("Pan rústico")
      .closest("li")
      ?.querySelector("[data-estado]") as HTMLElement;
    expect(caja.querySelector("img")).toBeNull();
    expect(caja.getBoundingClientRect().width).toBe(72);
    expect(caja.getBoundingClientRect().height).toBe(54);
  });
});

describe("carta: tamaño de la letra (D4 y D10)", () => {
  const PASOS = [
    ["Letra normal", 18],
    ["Letra grande", 22],
    ["Letra muy grande", 25],
  ] as const;

  it.each(PASOS)(
    "%s: nombre y precio ≥ 18 px, precio con peso ≥ 600 y nada bajo 16 px",
    async (paso, base) => {
      await abrirVidriera();
      await elegirLetra(paso);
      const [nombre, precio] = nombreYPrecio(enlaceDe("Capuchino"));
      expect(px(nombre)).toBeGreaterThanOrEqual(18);
      expect(px(precio)).toBeGreaterThanOrEqual(18);
      expect(px(precio)).toBeCloseTo(base, 1);
      expect(parseInt(getComputedStyle(precio).fontWeight, 10)).toBeGreaterThanOrEqual(600);
      await userEvent.click(enlaceDe("Café helado"));
      for (const el of conTexto(document.querySelector("main") as HTMLElement)) {
        expect(px(el), `${el.className}: ${el.textContent}`).toBeGreaterThanOrEqual(16);
        expect(px(el, "lineHeight") / px(el), el.textContent ?? "").toBeGreaterThanOrEqual(1.4);
      }
    },
  );

  it("los tres pasos cambian el tamaño (18, 22 y 25 px) y la perilla del comerciante parte de otro valor", async () => {
    const { unmount } = await abrirVidriera();
    const tamanos: number[] = [];
    for (const [paso] of PASOS) {
      await elegirLetra(paso);
      tamanos.push(px(nombreYPrecio(enlaceDe("Capuchino"))[1]));
    }
    expect(tamanos.map(Math.round)).toEqual([18, 22, 25]);
    await unmount();
    window.localStorage.clear();
    await abrirVidriera(vidrieraDePrueba({ letraBase: "GRANDE" }));
    expect(px(nombreYPrecio(enlaceDe("Capuchino"))[1])).toBeCloseTo(22, 1);
    await elegirLetra("Letra grande");
    expect(px(nombreYPrecio(enlaceDe("Capuchino"))[1])).toBeGreaterThan(26);
  });

  it("el control tiene tres pasos de 48 x 48 px o más, con el elegido marcado", async () => {
    await abrirVidriera();
    const botones = ["Letra normal", "Letra grande", "Letra muy grande"].map((n) =>
      page.getByRole("button", { name: n }).element(),
    );
    for (const b of botones) {
      const r = b.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(48);
      expect(r.height).toBeGreaterThanOrEqual(48);
    }
    expect(botones.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    await elegirLetra("Letra grande");
    expect(botones.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("sin JavaScript (antes de hidratar) la carta ya está con el tamaño de partida y sin control", () => {
    const html = renderToString(<PlantillaDeVidriera vista={vidrieraDePrueba()} textos={TEXTOS} />);
    expect(html).toContain('data-letra="NORMAL"');
    expect(html).toContain("desde $ 3.300");
    expect(html).toContain("Capuchino");
    expect(html).not.toContain("Letra normal");
  });
});

describe("carta: hidratación", () => {
  it("el HTML del servidor se hidrata sin diferencias, aun con un paso guardado, y aparece el control", async () => {
    window.localStorage.setItem(CLAVE_DE_LETRA_GUARDADA, "GRANDE");
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const vista = vidrieraDePrueba();
    const contenedor = document.createElement("div");
    contenedor.innerHTML = renderToString(<PlantillaDeVidriera vista={vista} textos={TEXTOS} />);
    document.body.append(contenedor);
    const raiz = hydrateRoot(contenedor, <PlantillaDeVidriera vista={vista} textos={TEXTOS} />);
    await expect
      .element(page.getByRole("button", { name: "Letra grande" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(errores).not.toHaveBeenCalled();
    raiz.unmount();
    contenedor.remove();
  });
});

describe("carta: sin desplazamiento horizontal ni texto cortado (D10 c)", () => {
  function sinDesbordes() {
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const a of document.querySelectorAll<HTMLElement>("a[data-segmento]")) {
      const [nombre, precio] = nombreYPrecio(a);
      for (const el of [nombre, precio]) {
        expect(el.scrollWidth, el.textContent ?? "").toBeLessThanOrEqual(el.clientWidth + 1);
        expect(el.getBoundingClientRect().right, el.textContent ?? "").toBeLessThanOrEqual(
          window.innerWidth,
        );
        expect(el.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      }
      // El precio no pisa al nombre: o está a su derecha o debajo.
      const n = nombre.getBoundingClientRect();
      const p = precio.getBoundingClientRect();
      expect(p.left >= n.right - 1 || p.top >= n.bottom - 1, a.textContent ?? "").toBe(true);
    }
  }

  it("con «muy grande»", async () => {
    await abrirVidriera();
    await elegirLetra("Letra muy grande");
    sinDesbordes();
  });

  it("con «muy grande» y la letra de la página al 200 %", async () => {
    await abrirVidriera(vidrieraDePrueba({ letraBase: "GRANDE" }));
    await elegirLetra("Letra muy grande");
    document.documentElement.style.fontSize = "200%";
    sinDesbordes();
  });

  it("con «muy grande», 200 % y la tarjeta abierta no hay desborde horizontal", async () => {
    await abrirVidriera();
    await elegirLetra("Letra muy grande");
    document.documentElement.style.fontSize = "200%";
    await userEvent.click(enlaceDe("Capuchino"));
    const dialogo = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialogo.scrollWidth).toBeLessThanOrEqual(dialogo.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("en una ventana angosta (equivale a 200 % de zoom del navegador) con «muy grande»", async () => {
    await abrirVidriera();
    await elegirLetra("Letra muy grande");
    await page.viewport(195, 844);
    try {
      sinDesbordes();
    } finally {
      await page.viewport(390, 844);
    }
  });
});

describe("carta: abrir y cerrar la tarjeta sin perder el lugar (C-5)", () => {
  it("abre con la dirección del producto; «Atrás» la cierra, el ítem sigue donde estaba y con el foco", async () => {
    await abrirVidriera();
    const item = enlaceDe("Brownie 18");
    item.scrollIntoView({ block: "center" });
    const antes = window.scrollY;
    const caja = item.getBoundingClientRect();
    await userEvent.click(item);
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(window.location.pathname).toBe(item.getAttribute("href"));
    window.history.back();
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
    expect(window.location.href).toBe(URL_INICIAL);
    expect(window.scrollY).toBe(antes);
    expect(item.getBoundingClientRect().top).toBeCloseTo(caja.top, 0);
    expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(item.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(document.activeElement).toBe(item);
  });

  it.each([
    ["Escape", async () => userEvent.keyboard("{Escape}")],
    [
      "«Volver a la carta»",
      async () => userEvent.click(page.getByRole("button", { name: "Volver a la carta" })),
    ],
    [
      "el botón «Cerrar»",
      async () => userEvent.click(page.getByRole("button", { name: "Cerrar" })),
    ],
  ])(
    "%s cierra, vuelve a la dirección de la carta y devuelve el foco al ítem",
    async (_n, cerrar) => {
      await abrirVidriera();
      const item = enlaceDe("Capuchino");
      await userEvent.click(item);
      await expect.element(page.getByRole("dialog")).toBeVisible();
      await cerrar();
      await vi.waitFor(() => {
        expect(document.querySelector("dialog")?.open).toBe(false);
      });
      expect(window.location.href).toBe(URL_INICIAL);
      expect(document.activeElement).toBe(item);
    },
  );

  it("tocar el fondo cierra la hoja (vistazo)", async () => {
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    (document.querySelector("dialog") as HTMLDialogElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
  });

  it("con teclado: Enter en el ítem abre, el foco inicial es el título, y el nombre y el precio describen la hoja", async () => {
    await abrirVidriera();
    const item = enlaceDe("Capuchino");
    item.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("dialog", { name: "Capuchino" })).toBeVisible();
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.textContent).toBe("Capuchino");
    expect(
      document.getElementById(
        document.querySelector("dialog")?.getAttribute("aria-describedby") ?? "",
      )?.textContent,
    ).toContain("Chico$ 3.300");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(item);
    });
  });

  it("la hoja es una hoja inferior de hasta el 90 % del alto y sus botones miden 48 px o más", async () => {
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    const caja = (document.querySelector("dialog") as HTMLElement).getBoundingClientRect();
    await vi.waitFor(() => {
      expect((document.querySelector("dialog") as HTMLElement).getBoundingClientRect().bottom).toBe(
        window.innerHeight,
      );
    });
    expect(caja.height).toBeLessThanOrEqual(window.innerHeight * 0.9 + 1);
    for (const nombre of ["Cerrar", "Compartir", "Volver a la carta"]) {
      const r = page.getByRole("button", { name: nombre }).element().getBoundingClientRect();
      expect(r.height, nombre).toBeGreaterThanOrEqual(48);
      expect(r.width, nombre).toBeGreaterThanOrEqual(48);
    }
  });

  it("un toque con Ctrl no abre la tarjeta: sigue siendo un enlace (se abre en otra pestaña)", async () => {
    await abrirVidriera();
    const evento = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    enlaceDe("Capuchino").addEventListener(
      "click",
      (e) => {
        e.preventDefault();
      },
      { once: true },
    );
    enlaceDe("Capuchino").dispatchEvent(evento);
    expect(document.querySelector("dialog")?.open).toBe(false);
  });
});

describe("carta: índice y botón «Secciones» (D2)", () => {
  it("desde el último ítem: botón flotante → índice → sección, con el título en pantalla y con el foco", async () => {
    await abrirVidriera();
    const ultimo = [...document.querySelectorAll("a[data-segmento]")].at(-1) as HTMLElement;
    ultimo.scrollIntoView();
    const flotante = page.getByRole("link", { name: "Ir al índice de secciones" });
    const r = flotante.element().getBoundingClientRect();
    expect(r.height).toBeGreaterThanOrEqual(48);
    expect(r.bottom).toBeLessThanOrEqual(window.innerHeight);
    await userEvent.click(flotante);
    const indice = document.getElementById("pd-indice") as HTMLElement;
    expect(window.location.hash).toBe("#pd-indice");
    expect(indice.getBoundingClientRect().top).toBeGreaterThanOrEqual(-1);
    expect(indice.getBoundingClientRect().top).toBeLessThan(window.innerHeight);
    await userEvent.click(page.getByRole("link", { name: /^Salados/ }));
    const titulo = document.getElementById("salados") as HTMLElement;
    expect(window.location.hash).toBe("#salados");
    expect(titulo.getBoundingClientRect().top).toBeGreaterThanOrEqual(-1);
    expect(titulo.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(document.activeElement).toBe(titulo);
  });

  it("el índice lista cada sección con la cantidad de productos", async () => {
    const vista = vidrieraDePrueba({ cantidad: 12 });
    await abrirVidriera(vista);
    const nav = page.getByRole("navigation", { name: "Secciones" }).element();
    for (const s of vista.secciones) {
      expect(nav.textContent).toContain(`${s.nombre}${s.productos.length}`);
    }
  });
});

describe("carta: compartir (§3.1, C-6)", () => {
  it("con Web Share le pasa la dirección completa del producto", async () => {
    const compartir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: compartir, configurable: true });
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await userEvent.click(page.getByRole("button", { name: "Compartir" }));
    await vi.waitFor(() => {
      expect(compartir).toHaveBeenCalledTimes(1);
    });
    expect(compartir).toHaveBeenCalledWith({
      title: "Capuchino",
      url: new URL(CAPUCHINO.href, window.location.href).toString(),
    });
  });

  it("sin Web Share copia el enlace y lo anuncia en la región de estado", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const escribir = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await userEvent.click(page.getByRole("button", { name: "Compartir" }));
    await expect
      .element(page.getByRole("dialog").getByRole("status"))
      .toHaveTextContent("Enlace copiado");
    expect(escribir).toHaveBeenCalledWith(new URL(CAPUCHINO.href, window.location.href).toString());
    expect(document.querySelector('dialog [aria-live="polite"]')?.textContent).toBe(
      "Enlace copiado",
    );
  });

  it("si cerrar la hoja del sistema (AbortError) no copia ni dice nada", async () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("cancelado", "AbortError")),
      configurable: true,
    });
    const escribir = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await userEvent.click(page.getByRole("button", { name: "Compartir" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(escribir).not.toHaveBeenCalled();
    expect(document.querySelector('dialog [aria-live="polite"]')?.textContent).toBe("");
  });

  it("si Web Share falla de verdad, copia; si copiar falla, lo dice", async () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")),
      configurable: true,
    });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denegado"));
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await userEvent.click(page.getByRole("button", { name: "Compartir" }));
    await expect
      .element(page.getByText("No se pudo copiar el enlace. Probá de nuevo."))
      .toBeVisible();
  });
});

describe("carta: buscar (D8)", () => {
  it("con 41 productos aparece el campo y con 40 no", async () => {
    const { unmount } = await abrirVidriera(vidrieraDePrueba({ cantidad: 41 }));
    expect(page.getByRole("searchbox", { name: "Buscar en la carta" }).query()).not.toBeNull();
    await unmount();
    await abrirVidriera(vidrieraDePrueba({ cantidad: 40 }));
    expect(page.getByRole("searchbox").query()).toBeNull();
  });

  it("filtra sin acentos ni mayúsculas, mantiene las secciones, anuncia la cantidad y no hace pedidos de red", async () => {
    await abrirVidriera();
    const pedidos = performance.getEntriesByType("resource").length;
    await userEvent.fill(page.getByRole("searchbox"), "NOQUIS");
    await expect
      .element(page.getByRole("search").getByRole("status"))
      .toHaveTextContent("1 resultado");
    expect(document.querySelectorAll("a[data-segmento]")).toHaveLength(1);
    expect(document.querySelectorAll("section > h2")).toHaveLength(1);
    expect(document.querySelector("section > h2")?.textContent).toBe("Cafés");
    expect(NOQUIS.nombre).toBe("Ñoquis de calabaza");
    expect(performance.getEntriesByType("resource").length).toBe(pedidos);
    await userEvent.fill(page.getByRole("searchbox"), "de");
    await vi.waitFor(() => {
      expect(page.getByRole("search").getByRole("status").element().textContent).toMatch(
        /^\d+ resultados$/,
      );
    });
  });

  it("busca también en la descripción", async () => {
    await abrirVidriera();
    await userEvent.fill(page.getByRole("searchbox"), "espumada");
    expect(document.querySelectorAll("a[data-segmento]")).toHaveLength(1);
    expect(enlaceDe("Capuchino")).toBeTruthy();
  });

  it("sin resultados: lo dice, no deja secciones ni índice, y «Limpiar» devuelve todo y el foco al campo", async () => {
    await abrirVidriera();
    await userEvent.fill(page.getByRole("searchbox"), "zzzz");
    await expect
      .element(page.getByRole("search").getByRole("status"))
      .toHaveTextContent("No hay nada que diga «zzzz».");
    expect(document.querySelectorAll("a[data-segmento]")).toHaveLength(0);
    expect(document.getElementById("pd-indice")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Limpiar búsqueda" }).first());
    expect(document.querySelectorAll("a[data-segmento]")).toHaveLength(60);
    expect(document.activeElement).toBe(page.getByRole("searchbox").element());
  });

  it("con la búsqueda, el índice solo lista las secciones con resultados", async () => {
    await abrirVidriera();
    await userEvent.fill(page.getByRole("searchbox"), "milanesa");
    const nav = page.getByRole("navigation", { name: "Secciones" }).element();
    expect(nav.querySelectorAll("li")).toHaveLength(1);
    expect(MILANESA.nombre).toContain("milanesa");
  });
});

describe("carta: «Letra» se recuerda y no depende del almacenamiento (D10)", () => {
  it("se guarda al elegir y la próxima visita parte de ahí", async () => {
    const { unmount } = await abrirVidriera();
    await elegirLetra("Letra muy grande");
    expect(window.localStorage.getItem(CLAVE_DE_LETRA_GUARDADA)).toBe("MUY_GRANDE");
    await unmount();
    await abrirVidriera();
    await expect
      .element(page.getByRole("button", { name: "Letra muy grande" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(px(nombreYPrecio(enlaceDe("Capuchino"))[1])).toBeCloseTo(25, 1);
  });

  it("un valor roto en el almacenamiento vuelve al paso normal", async () => {
    window.localStorage.setItem(CLAVE_DE_LETRA_GUARDADA, "ENORME");
    await abrirVidriera();
    await expect
      .element(page.getByRole("button", { name: "Letra normal" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("con el almacenamiento bloqueado (ventana privada) la letra cambia igual y nada se rompe", async () => {
    const bloqueo = () => {
      throw new DOMException("bloqueado", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(bloqueo);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(bloqueo);
    const errores: string[] = [];
    const alError = (e: ErrorEvent) => {
      e.preventDefault();
      errores.push(e.message);
    };
    window.addEventListener("error", alError);
    await abrirVidriera();
    await elegirLetra("Letra grande");
    window.removeEventListener("error", alError);
    // Si guardar lanzara, el error saldría del manejador del toque: no tiene que haber ninguno.
    expect(errores).toEqual([]);
    expect(px(nombreYPrecio(enlaceDe("Capuchino"))[1])).toBeCloseTo(22, 1);
    await expect
      .element(page.getByRole("button", { name: "Letra grande" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});

describe("carta: sin cookies ni almacenamiento salvo «Letra» (C-13)", () => {
  it("usarla (abrir tarjetas, buscar, ir a una sección) no deja cookies ni claves; solo «Letra» guarda su paso", async () => {
    await abrirVidriera();
    await userEvent.click(enlaceDe("Capuchino"));
    await userEvent.keyboard("{Escape}");
    await userEvent.fill(page.getByRole("searchbox"), "caf");
    expect(document.cookie).toBe("");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await elegirLetra("Letra grande");
    expect(document.cookie).toBe("");
    expect(Object.keys(window.localStorage)).toEqual([CLAVE_DE_LETRA_GUARDADA]);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("carta: el texto usa solo colores semánticos (D4)", () => {
  it("nombre, precio y descripción son del color de texto; lo suave y «Agotado» tienen su token; ninguno toma la marca", async () => {
    await abrirVidriera();
    const css = getComputedStyle(document.documentElement);
    const token = (n: string) => {
      const sonda = document.createElement("span");
      sonda.style.color = `var(${n})`;
      document.body.append(sonda);
      const c = getComputedStyle(sonda).color;
      sonda.remove();
      return c;
    };
    expect(css.getPropertyValue("--brand-primary")).not.toBe("");
    const marca = [token("--brand-primary"), token("--brand-accent"), token("--brand-secondary")];
    const [nombre, precio] = nombreYPrecio(enlaceDe("Capuchino"));
    expect(getComputedStyle(nombre).color).toBe(token("--color-texto"));
    expect(getComputedStyle(precio).color).toBe(token("--color-texto"));
    expect(getComputedStyle(enlaceDe("Capuchino").nextElementSibling as Element).color).toBe(
      token("--color-texto-suave"),
    );
    const agotado = [
      ...(enlaceDe("Café helado").parentElement?.querySelectorAll("span") ?? []),
    ].find((s) => s.textContent === "Agotado");
    expect(getComputedStyle(agotado as Element).color).toBe(token("--color-agotado"));
    // Todo texto de la carta, salvo la cabecera sobre el color de la marca, evita los colores de la marca.
    const cabecera = document.querySelector("header") as HTMLElement;
    for (const el of conTexto(document.querySelector("main") as HTMLElement)) {
      if (cabecera.contains(el)) continue;
      expect(marca, `${el.textContent}`).not.toContain(getComputedStyle(el).color);
    }
  });
});

describe("carta: forma", () => {
  it("la cabecera muestra rubro, nombre y lugar; sin lugar no hay línea", async () => {
    const { unmount } = await abrirVidriera();
    expect(document.querySelector("header")?.textContent).toContain("Av. Belgrano 412");
    await unmount();
    await abrirVidriera(vidrieraDePrueba({ lugar: null }));
    expect(document.querySelector("header")?.textContent).not.toContain("Belgrano");
    expect(document.querySelectorAll("header p")).toHaveLength(1);
  });

  it("la palabra más larga se parte y la descripción de varias líneas conserva sus saltos", async () => {
    await abrirVidriera();
    expect(LARGO.nombre.length).toBeGreaterThan(40);
    expect(enlaceDe("Ñoquis").nextElementSibling?.textContent).toContain("Salsa fileto o crema.");
    expect(getComputedStyle(enlaceDe("Ñoquis").nextElementSibling as Element).whiteSpace).toBe(
      "pre-line",
    );
    expect(SIN_NADA.nombre).toBe("Medialuna");
    expect(CON_FOTO.foto).not.toBeNull();
    expect(MILANESA.guarnicion).toContain("papas fritas");
  });

  it("el pie dice que los precios incluyen IVA", async () => {
    await abrirVidriera();
    await expect.element(page.getByText("Los precios incluyen IVA.")).toBeVisible();
  });
});
