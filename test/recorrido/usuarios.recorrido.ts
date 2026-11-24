import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import { ingresarEn, personaVinculada } from "../integracion/web-apoyo";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
} from "../integracion/fixtures-identidad";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Usuarios» de Cuenta (tramo U1, solo lectura) de punta a punta en la app REAL construida, con un navegador real y una base real: el gerente entra desde Cuenta → «Usuarios» y ve a la gente de su empresa
 * con su rol («Gerente», «Administrador», «Empleado»), a la desactivada con su texto y las invitaciones con «Vence el …», «Vencida» o «Pendiente»; abre la ficha de una persona; nunca ve a nadie de otra empresa (la
 * ficha de una ajena dice lo mismo que una inexistente). Después la misma persona pasa a ser empleada: la entrada «Usuarios» desaparece de Cuenta y, abriendo la dirección a mano, el servidor responde con el
 * mensaje genérico, sin filas. Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso y la lectura de la base), la fila del menú y que los componentes no rompan en el navegador.
 * El tramo U4 suma las sucursales del empleado: tildar y guardar (R1), guardar sin cambios no deja constancia (R2) y dos pestañas dejan la última edición completa (R3).
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";
const DIA = 86_400_000;

describe.skipIf(base === null)("recorrido de la lista de usuarios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let sofia = "";
  let diego = "";
  let deOtraEmpresa = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    const tenant = (
      await c.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        mundo.empresa,
      ])
    ).rows[0]?.tenant_id as string;
    const sumar = async (email: string, rol: "ADMINISTRADOR" | "OPERADOR", activo = true) => {
      const persona = await crearPersonaDeBase(c, email);
      await crearMembresiaDeBase(c, mundo.empresa, persona.id, rol, activo);
      return persona.id;
    };
    diego = await sumar("diego@lacteos.test", "ADMINISTRADOR");
    sofia = await sumar("sofia@lacteos.test", "OPERADOR");
    await sumar("ana@lacteos.test", "OPERADOR", false);
    const ahora = Date.now();
    for (const [email, rol, vence] of [
      ["julia@lacteos.test", "OPERADOR", ahora + 5 * DIA],
      ["pablo@lacteos.test", "ADMINISTRADOR", ahora - 2 * DIA],
    ] as const) {
      const inv = await crearInvitacionDeBase(c, { tenant, email, venceEn: new Date(vence) });
      await incluirEmpresa(c, inv, mundo.empresa, rol);
    }
    // Otra empresa (otro tenant) con su gente y su invitación: nada de esto tiene que verse.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    const ajena = await crearPersonaDeBase(c, "ajena@otra-empresa.test");
    await crearMembresiaDeBase(c, otra.empresa, ajena.id, "OPERADOR");
    deOtraEmpresa = ajena.id;
    const invAjena = await crearInvitacionDeBase(c, {
      tenant: otra.tenant,
      email: "invitada@otra-empresa.test",
      venceEn: new Date(ahora + 3 * DIA),
    });
    await incluirEmpresa(c, invAjena, otra.empresa, "OPERADOR");

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente entra desde Cuenta → «Usuarios» y ve a su gente y sus invitaciones, sin nada de otra empresa", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Usuarios" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Invitaciones" }).waitFor();

    const fila = (nombre: string) => pagina.getByRole("link", { name: nombre, exact: true });
    expect(await fila("diego@lacteos.test Administrador").count()).toBe(1);
    expect(await fila("sofia@lacteos.test Empleado").count()).toBe(1);
    expect(await fila("ana@lacteos.test Empleado Desactivado").count()).toBe(1);
    expect(await pagina.getByText("Gerente", { exact: false }).count()).toBeGreaterThan(0);
    await pagina.getByText("Empleado · Vence el", { exact: false }).first().waitFor();
    expect(await pagina.getByText("Vencida").count()).toBe(1);
    expect(await pagina.getByText("Pendiente").count()).toBe(1);
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    expect(await pagina.getByText("invitada@otra-empresa.test").count()).toBe(0);
    expect(
      await pagina.getByRole("button", { name: /Invitar|Desactivar|Reactivar|Guardar/ }).count(),
    ).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("la ficha de una persona de la empresa muestra su rol y su estado; la de una de otra empresa dice lo mismo que una que no existe", async () => {
    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByRole("heading", { name: "sofia@lacteos.test" }).waitFor();
    await pagina.getByText("Empleado").first().waitFor();
    await pagina.getByText("Activo").first().waitFor();
    // Un empleado activo trae el bloque «Sucursales» con su «Guardar» (tramo U4); su prueba completa es la del bloque siguiente.
    await pagina.getByRole("group", { name: "Sucursales" }).waitFor();
    await sinViolacionesDeAxe();

    // El administrador y el gerente trabajan en todas las sucursales: su ficha no dice nada de sucursales ni tiene botones.
    await ir(`/cuenta/usuarios/${diego}`);
    await pagina.getByRole("heading", { name: "diego@lacteos.test" }).waitFor();
    await pagina.getByText("Administrador").first().waitFor();
    expect(await pagina.getByRole("button").count()).toBe(0);
    expect(await pagina.getByText("Sucursales").count()).toBe(0);

    await ir(`/cuenta/usuarios/${deOtraEmpresa}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    await ir("/cuenta/usuarios/0b0b0b0b-1111-4222-8333-4444444444ee");
    await pagina.getByText(GENERICO).first().waitFor();
    await ir("/cuenta/usuarios/no-es-un-id");
    await pagina.getByText(GENERICO).first().waitFor();
    pantallaLimpia();
  });

  it("U4: tildar sucursales en la ficha del empleado y guardar; guardar lo mismo no deja constancia nueva; dos pestañas dejan la última, completa", async () => {
    const c = mundo.mundo.dueno;
    const norte = (
      await c.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    const sur = (
      await c.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Sur') returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    await c.query(
      "insert into sucursal (empresa_id, nombre, activa) values ($1, 'Cerrada', false)",
      [mundo.empresa],
    );
    const asignadas = async () =>
      (
        await c.query<{ sucursal_id: string }>(
          "select sucursal_id from asignacion_sucursal where empresa_id = $1 and persona_id = $2 and activa order by sucursal_id",
          [mundo.empresa, sofia],
        )
      ).rows.map((f) => f.sucursal_id);
    const auditorias = async () =>
      Number(
        (
          await c.query<{ n: string }>(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'ASIGNACIONES_CAMBIADAS' and entidad_id = $2",
            [mundo.empresa, sofia],
          )
        ).rows[0]?.n,
      );
    const guardar = async (p: Page) => {
      await p.getByRole("button", { name: "Guardar" }).click();
      await p.waitForLoadState("networkidle");
    };

    // R1: tildar «Norte» y «Sur», guardar, recargar y verlas tildadas; la desactivada no se ofrece.
    await ir(`/cuenta/usuarios/${sofia}`);
    const grupo = pagina.getByRole("group", { name: "Sucursales" });
    await grupo.waitFor();
    expect(await grupo.getByRole("checkbox").count()).toBe(3);
    expect(await pagina.getByText("Cerrada").count()).toBe(0);
    await grupo.getByRole("checkbox", { name: "Norte" }).check();
    await grupo.getByRole("checkbox", { name: "Sur" }).check();
    await guardar(pagina);
    await expect.poll(asignadas).toEqual([norte, sur].sort());
    await ir(`/cuenta/usuarios/${sofia}`);
    expect(await grupo.getByRole("checkbox", { name: "Norte" }).isChecked()).toBe(true);
    expect(await grupo.getByRole("checkbox", { name: "Sur" }).isChecked()).toBe(true);
    expect(await auditorias()).toBe(1);

    // R2: guardar sin cambios no deja constancia nueva.
    await guardar(pagina);
    await guardar(pagina);
    expect(await auditorias()).toBe(1);
    expect(await asignadas()).toEqual([norte, sur].sort());

    // R3: dos pestañas con la ficha vieja; la que guarda última deja su conjunto, completo y sin mezclar.
    const otraPestana = await contexto.newPage();
    try {
      await otraPestana.goto(`${mundo.url}/cuenta/usuarios/${sofia}`);
      await otraPestana.waitForLoadState("networkidle");
      await ir(`/cuenta/usuarios/${sofia}`);
      await grupo.getByRole("checkbox", { name: "Norte" }).uncheck();
      await guardar(pagina); // queda solo «Sur»
      await expect.poll(asignadas).toEqual([sur]);
      const suya = otraPestana.getByRole("group", { name: "Sucursales" });
      await suya.getByRole("checkbox", { name: "Sur" }).uncheck(); // la vista vieja tenía Norte y Sur: queda solo «Norte»
      await guardar(otraPestana); // gana la última (sin aviso: pregunta 10 del plan), con su conjunto completo
      await expect.poll(asignadas).toEqual([norte]);
      await ir(`/cuenta/usuarios/${sofia}`);
      expect(await grupo.getByRole("checkbox", { checked: true }).count()).toBe(1);
      expect(await grupo.getByRole("checkbox", { name: "Norte" }).isChecked()).toBe(true);
    } finally {
      await otraPestana.close();
    }
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("un empleado no tiene la entrada «Usuarios» y, abriendo la dirección a mano, recibe el genérico y ninguna fila", async () => {
    // Otra persona que entra de verdad (misma app y misma base) y es EMPLEADA de la empresa.
    const otra = await ingresarEn(mundo.mundo, HOST_DEL_RECORRIDO);
    const empleada = await personaVinculada(mundo.mundo, otra.sesion);
    await crearMembresiaDeBase(mundo.mundo.dueno, mundo.empresa, empleada, "OPERADOR");
    const suContexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await suContexto.addCookies(
      otra.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((c) => ({
        name: c.nombre,
        value: c.valor,
        domain: HOST_DEL_RECORRIDO,
        path: "/" as const,
        httpOnly: true as const,
        secure: true as const,
      })),
    );
    pagina = await suContexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);

    await ir("/cuenta");
    await pagina.getByRole("button", { name: "Cerrar sesión" }).waitFor();
    expect(await pagina.getByRole("link", { name: "Usuarios" }).count()).toBe(0);

    await ir("/cuenta/usuarios");
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("@lacteos.test", { exact: false }).count()).toBe(0);
    expect(await pagina.getByRole("heading", { name: "Invitaciones" }).count()).toBe(0);

    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("sofia@lacteos.test").count()).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
    await suContexto.close();
  });
});
