# Textos de las acciones de los roles propios (propuesta)

Propuesta de nombre humano para cada acción del catálogo (`ID de acción`), para las casillas de la pantalla «Roles». **Pendiente de aprobación del dueño**: ningún texto de esta tabla es definitivo. Generada desde el catálogo de módulos y la matriz de permisos de `integracion/modulos-v2`; son 188 acciones.

- **Piso**: `solo gerente` = la acción nunca se puede dar a un rol propio (el gerente es el único); `todos los roles` = viene siempre en todos los roles (no se puede quitar); `no` = se puede delegar a un rol propio si el plan incluye el módulo.
- **Rol que la tiene por defecto**: Gerente, Administrador y/o Empleado (OPERADOR). Un rol propio parte vacío o copiando una plantilla; esta columna solo orienta.
- Una acción de un módulo que el plan de la empresa no incluye se muestra deshabilitada («No incluida en el plan»).

| ID de acción                              | Módulo                 | Texto humano propuesto                                    | Piso (sí/no)    | Rol que la tiene por defecto       |
| ----------------------------------------- | ---------------------- | --------------------------------------------------------- | --------------- | ---------------------------------- |
| `usuarios.invitar`                        | Administración         | Invitar usuarios                                          | no              | Gerente · Administrador            |
| `usuarios.reenviar_invitacion`            | Administración         | Reenviar una invitación                                   | no              | Gerente · Administrador            |
| `usuarios.apagar`                         | Administración         | Dar de baja a un usuario                                  | no              | Gerente · Administrador            |
| `usuarios.ver`                            | Administración         | Ver los usuarios                                          | no              | Gerente · Administrador            |
| `usuarios.asignar_sucursales`             | Administración         | Asignar sucursales a un usuario                           | no              | Gerente · Administrador            |
| `usuarios.revocar_invitacion`             | Administración         | Revocar una invitación                                    | no              | Gerente · Administrador            |
| `roles.ver`                               | Administración         | Ver los roles                                             | solo gerente    | Gerente                            |
| `roles.crear`                             | Administración         | Crear roles                                               | solo gerente    | Gerente                            |
| `roles.editar`                            | Administración         | Editar roles                                              | solo gerente    | Gerente                            |
| `roles.archivar`                          | Administración         | Archivar roles                                            | solo gerente    | Gerente                            |
| `usuarios.asignar_rol`                    | Administración         | Asignar un rol a un usuario                               | solo gerente    | Gerente                            |
| `sucursales.ver`                          | Administración         | Ver las sucursales                                        | no              | Gerente · Administrador            |
| `sucursales.crear`                        | Administración         | Crear sucursales                                          | no              | Gerente · Administrador            |
| `sucursales.editar`                       | Administración         | Editar sucursales                                         | no              | Gerente · Administrador            |
| `sucursales.desactivar`                   | Administración         | Desactivar sucursales                                     | solo gerente    | Gerente                            |
| `sucursales.reactivar`                    | Administración         | Reactivar sucursales                                      | solo gerente    | Gerente                            |
| `gerencia.proponer_traspaso`              | Administración         | Proponer el traspaso de la gerencia                       | solo gerente    | Gerente                            |
| `gerencia.cancelar_traspaso`              | Administración         | Cancelar el traspaso de la gerencia                       | solo gerente    | Gerente                            |
| `gerencia.ver_traspaso`                   | Administración         | Ver el traspaso de la gerencia                            | todos los roles | Gerente · Administrador · Empleado |
| `gerencia.aceptar_traspaso`               | Administración         | Aceptar el traspaso de la gerencia                        | todos los roles | Gerente · Administrador · Empleado |
| `gerencia.rechazar_traspaso`              | Administración         | Rechazar el traspaso de la gerencia                       | todos los roles | Gerente · Administrador · Empleado |
| `modulos.ver`                             | Administración         | Ver los módulos de la empresa                             | no              | Gerente · Administrador            |
| `permisos.ver_propios`                    | Administración         | Ver los propios permisos                                  | todos los roles | Gerente · Administrador · Empleado |
| `datos_fiscales.editar`                   | Administración         | Editar los datos fiscales                                 | solo gerente    | Gerente                            |
| `datos_fiscales.confirmar`                | Administración         | Confirmar los datos fiscales                              | solo gerente    | Gerente                            |
| `puntos_de_venta.crear`                   | Administración         | Crear puntos de venta                                     | solo gerente    | Gerente                            |
| `puntos_de_venta.editar`                  | Administración         | Editar puntos de venta                                    | solo gerente    | Gerente                            |
| `puntos_de_venta.activar`                 | Administración         | Activar puntos de venta                                   | solo gerente    | Gerente                            |
| `puntos_de_venta.desactivar`              | Administración         | Desactivar puntos de venta                                | solo gerente    | Gerente                            |
| `emisores.confirmar_regla`                | Administración         | Confirmar la regla del emisor fiscal                      | solo gerente    | Gerente                            |
| `comprobantes.emitir`                     | Facturación            | Emitir comprobantes                                       | no              | Gerente · Administrador · Empleado |
| `comprobantes.ver`                        | Facturación            | Ver los comprobantes                                      | no              | Gerente · Administrador · Empleado |
| `comprobantes.emitir_manual`              | Facturación            | Emitir un comprobante a mano                              | no              | Gerente · Administrador · Empleado |
| `notas_de_credito.emitir`                 | Facturación            | Emitir notas de crédito                                   | no              | Gerente · Administrador · Empleado |
| `comprobantes.descartar`                  | Facturación            | Descartar un comprobante pendiente                        | no              | Gerente · Administrador · Empleado |
| `comprobantes.reintentar`                 | Facturación            | Reintentar un comprobante                                 | no              | Gerente · Administrador · Empleado |
| `series.resincronizar`                    | Facturación            | Resincronizar la numeración de una serie                  | solo gerente    | Gerente                            |
| `puntos_de_venta.cambiar_ambiente`        | Facturación            | Cambiar el ambiente de un punto de venta                  | solo gerente    | Gerente                            |
| `certificados.gestionar`                  | Facturación            | Gestionar los certificados fiscales                       | solo gerente    | Gerente                            |
| `productos.ver`                           | Catálogo               | Ver los productos                                         | no              | Gerente · Administrador · Empleado |
| `productos.crear`                         | Catálogo               | Crear productos                                           | no              | Gerente · Administrador            |
| `productos.editar`                        | Catálogo               | Editar productos                                          | no              | Gerente · Administrador            |
| `productos.reactivar`                     | Catálogo               | Reactivar productos                                       | no              | Gerente · Administrador            |
| `productos.cambiar_precio`                | Catálogo               | Cambiar el precio de un producto                          | no              | Gerente · Administrador            |
| `productos.desactivar`                    | Catálogo               | Desactivar productos                                      | no              | Gerente · Administrador            |
| `opciones.editar`                         | Catálogo               | Editar las opciones de un producto                        | no              | Gerente · Administrador            |
| `variantes.editar`                        | Catálogo               | Editar las variantes de un producto                       | no              | Gerente · Administrador            |
| `vidrieras.ver`                           | Vidriera (cartas)      | Ver las cartas                                            | no              | Gerente · Administrador · Empleado |
| `vidrieras.marcar_disponibilidad`         | Vidriera (cartas)      | Marcar qué hay disponible en la carta                     | no              | Gerente · Administrador · Empleado |
| `vidrieras.ocultar_en_empresa`            | Vidriera (cartas)      | Ocultar un producto en toda la empresa                    | no              | Gerente · Administrador            |
| `vidrieras.crear`                         | Vidriera (cartas)      | Crear cartas                                              | no              | Gerente · Administrador            |
| `vidrieras.editar`                        | Vidriera (cartas)      | Editar cartas                                             | no              | Gerente · Administrador            |
| `vidrieras.publicar`                      | Vidriera (cartas)      | Publicar una carta                                        | no              | Gerente · Administrador            |
| `vidrieras.retirar`                       | Vidriera (cartas)      | Retirar una carta                                         | no              | Gerente · Administrador            |
| `vidrieras.publicar_en_linea`             | Vidriera (cartas)      | Publicar una carta en línea                               | no              | Gerente · Administrador            |
| `vidrieras.renovar_enlace`                | Vidriera (cartas)      | Renovar el enlace de la carta en línea                    | no              | Gerente · Administrador            |
| `vidrieras.retirar_de_linea`              | Vidriera (cartas)      | Retirar una carta de línea                                | no              | Gerente · Administrador            |
| `vidrieras.administrar_portal`            | Vidriera (cartas)      | Administrar el portal de la empresa                       | no              | Gerente · Administrador            |
| `vidrieras.administrar_cuentas_de_imagen` | Vidriera (cartas)      | Administrar las cuentas de imagen                         | no              | Gerente · Administrador            |
| `stock.ver`                               | Stock                  | Ver el stock                                              | no              | Gerente · Administrador · Empleado |
| `stock.verificar_saldos`                  | Stock                  | Verificar los saldos de stock                             | solo gerente    | Gerente                            |
| `costos.ver`                              | Stock                  | Ver los costos                                            | no              | Gerente · Administrador            |
| `stock.registrar_entrada`                 | Stock                  | Registrar una entrada de stock                            | no              | Gerente · Administrador · Empleado |
| `stock.registrar_salida`                  | Stock                  | Registrar una salida de stock                             | no              | Gerente · Administrador · Empleado |
| `stock.transferir`                        | Stock                  | Transferir stock entre depósitos                          | no              | Gerente · Administrador · Empleado |
| `stock.ajustar`                           | Stock                  | Ajustar el stock                                          | no              | Gerente · Administrador            |
| `stock.anular`                            | Stock                  | Anular un movimiento de stock                             | no              | Gerente · Administrador            |
| `depositos.crear`                         | Stock                  | Crear depósitos                                           | no              | Gerente · Administrador            |
| `depositos.editar`                        | Stock                  | Editar depósitos                                          | no              | Gerente · Administrador            |
| `depositos.reactivar`                     | Stock                  | Reactivar depósitos                                       | no              | Gerente · Administrador            |
| `depositos.desactivar`                    | Stock                  | Desactivar depósitos                                      | no              | Gerente · Administrador            |
| `articulos.controlar`                     | Stock                  | Controlar el stock de un artículo                         | no              | Gerente · Administrador            |
| `articulos.dejar_de_controlar`            | Stock                  | Dejar de controlar el stock de un artículo                | no              | Gerente · Administrador            |
| `composiciones.editar`                    | Stock                  | Editar las composiciones (recetas)                        | no              | Gerente · Administrador            |
| `conteos.abrir`                           | Stock                  | Abrir un conteo de stock                                  | no              | Gerente · Administrador            |
| `conteos.registrar`                       | Stock                  | Registrar lo contado                                      | no              | Gerente · Administrador · Empleado |
| `conteos.aplicar`                         | Stock                  | Aplicar un conteo al stock                                | no              | Gerente · Administrador            |
| `conteos.cancelar`                        | Stock                  | Cancelar un conteo                                        | no              | Gerente · Administrador            |
| `lotes.ver`                               | Stock                  | Ver los lotes                                             | no              | Gerente · Administrador · Empleado |
| `lotes.controlar`                         | Stock                  | Controlar lotes de un artículo                            | no              | Gerente · Administrador            |
| `lotes.dejar_de_controlar`                | Stock                  | Dejar de controlar lotes de un artículo                   | no              | Gerente · Administrador            |
| `lotes.cambiar_calidad`                   | Stock                  | Cambiar la calidad de un lote                             | no              | Gerente · Administrador            |
| `lotes.corregir`                          | Stock                  | Corregir un lote                                          | no              | Gerente · Administrador            |
| `lotes.reasignar`                         | Stock                  | Reasignar un lote                                         | no              | Gerente · Administrador            |
| `cajas.ver`                               | Caja                   | Ver las cajas                                             | no              | Gerente · Administrador · Empleado |
| `cajas.crear`                             | Caja                   | Crear cajas                                               | solo gerente    | Gerente                            |
| `cajas.editar`                            | Caja                   | Editar cajas                                              | no              | Gerente · Administrador            |
| `cajas.reactivar`                         | Caja                   | Reactivar cajas                                           | solo gerente    | Gerente                            |
| `cajas.desactivar`                        | Caja                   | Desactivar cajas                                          | solo gerente    | Gerente                            |
| `medios_de_pago.crear`                    | Caja                   | Crear medios de pago                                      | no              | Gerente · Administrador            |
| `medios_de_pago.editar`                   | Caja                   | Editar medios de pago                                     | no              | Gerente · Administrador            |
| `medios_de_pago.reactivar`                | Caja                   | Reactivar medios de pago                                  | no              | Gerente · Administrador            |
| `medios_de_pago.desactivar`               | Caja                   | Desactivar medios de pago                                 | no              | Gerente · Administrador            |
| `cuentas_de_cobro.crear`                  | Caja                   | Crear cuentas de cobro                                    | no              | Gerente · Administrador            |
| `cuentas_de_cobro.editar`                 | Caja                   | Editar cuentas de cobro                                   | no              | Gerente · Administrador            |
| `cuentas_de_cobro.reactivar`              | Caja                   | Reactivar cuentas de cobro                                | no              | Gerente · Administrador            |
| `cuentas_de_cobro.desactivar`             | Caja                   | Desactivar cuentas de cobro                               | no              | Gerente · Administrador            |
| `sesiones_caja.abrir`                     | Caja                   | Abrir la caja                                             | no              | Gerente · Administrador · Empleado |
| `sesiones_caja.iniciar_cierre`            | Caja                   | Iniciar el cierre de la caja                              | no              | Gerente · Administrador · Empleado |
| `sesiones_caja.cancelar_cierre`           | Caja                   | Cancelar el cierre de la caja                             | no              | Gerente · Administrador · Empleado |
| `sesiones_caja.cerrar`                    | Caja                   | Cerrar la caja                                            | no              | Gerente · Administrador · Empleado |
| `movimientos_caja.registrar_manual`       | Caja                   | Registrar un movimiento de caja a mano                    | no              | Gerente · Administrador · Empleado |
| `movimientos_caja.ajustar`                | Caja                   | Ajustar un movimiento de caja                             | no              | Gerente · Administrador            |
| `movimientos_caja.anular`                 | Caja                   | Anular un movimiento de caja propio                       | no              | Gerente · Administrador · Empleado |
| `movimientos_caja.anular_de_otros`        | Caja                   | Anular un movimiento de caja de otra persona              | no              | Gerente · Administrador            |
| `cobros.corregir_medio`                   | Caja                   | Corregir el medio de pago de un cobro                     | no              | Gerente · Administrador · Empleado |
| `declaraciones_de_total.registrar`        | Caja                   | Declarar el total contado en la caja                      | no              | Gerente · Administrador · Empleado |
| `jornadas.ver`                            | Cierre del día         | Ver las jornadas                                          | no              | Gerente · Administrador · Empleado |
| `jornadas.iniciar_auditoria`              | Cierre del día         | Iniciar la auditoría del día                              | no              | Gerente · Administrador · Empleado |
| `jornadas.cancelar_auditoria`             | Cierre del día         | Cancelar la auditoría del día                             | no              | Gerente · Administrador · Empleado |
| `jornadas.cerrar`                         | Cierre del día         | Cerrar el día                                             | no              | Gerente · Administrador · Empleado |
| `ventas.ver`                              | Ventas                 | Ver las ventas                                            | no              | Gerente · Administrador · Empleado |
| `cuentas.abrir`                           | Ventas                 | Abrir una cuenta                                          | no              | Gerente · Administrador · Empleado |
| `cuentas.agregar_linea`                   | Ventas                 | Agregar renglones a una cuenta                            | no              | Gerente · Administrador · Empleado |
| `cuentas.cerrar`                          | Ventas                 | Cerrar una cuenta                                         | no              | Gerente · Administrador · Empleado |
| `cuentas.anular_linea`                    | Ventas                 | Anular un renglón de una cuenta                           | no              | Gerente · Administrador · Empleado |
| `cuentas.anular`                          | Ventas                 | Anular una cuenta                                         | no              | Gerente · Administrador · Empleado |
| `tickets.cobrar`                          | Ventas                 | Cobrar un ticket                                          | no              | Gerente · Administrador · Empleado |
| `tickets.corregir`                        | Ventas                 | Corregir un ticket                                        | no              | Gerente · Administrador · Empleado |
| `comandas.ver`                            | Comandas               | Ver las comandas                                          | no              | Gerente · Administrador · Empleado |
| `comandas.enviar`                         | Comandas               | Enviar una comanda a cocina                               | no              | Gerente · Administrador · Empleado |
| `impresiones.imprimir`                    | Comandas               | Imprimir comandas y tickets                               | no              | Gerente · Administrador · Empleado |
| `impresiones.reimprimir`                  | Comandas               | Reimprimir comandas y tickets                             | no              | Gerente · Administrador · Empleado |
| `impresoras.ver`                          | Comandas               | Ver las impresoras                                        | no              | Gerente · Administrador · Empleado |
| `impresoras.crear`                        | Comandas               | Crear impresoras                                          | no              | Gerente · Administrador            |
| `impresoras.editar`                       | Comandas               | Editar impresoras                                         | no              | Gerente · Administrador            |
| `impresoras.desactivar`                   | Comandas               | Desactivar impresoras                                     | no              | Gerente · Administrador            |
| `mesas.ver`                               | Salón                  | Ver las mesas                                             | no              | Gerente · Administrador · Empleado |
| `mesas.crear`                             | Salón                  | Crear mesas                                               | no              | Gerente · Administrador            |
| `mesas.editar`                            | Salón                  | Editar mesas                                              | no              | Gerente · Administrador            |
| `mesas.reactivar`                         | Salón                  | Reactivar mesas                                           | no              | Gerente · Administrador            |
| `mesas.desactivar`                        | Salón                  | Desactivar mesas                                          | no              | Gerente · Administrador            |
| `salon.cambiar_mesa`                      | Salón                  | Cambiar una cuenta de mesa                                | no              | Gerente · Administrador · Empleado |
| `salon.unir`                              | Salón                  | Unir mesas                                                | no              | Gerente · Administrador · Empleado |
| `salon.dividir`                           | Salón                  | Dividir una cuenta                                        | no              | Gerente · Administrador · Empleado |
| `partes.ver`                              | Clientes y proveedores | Ver clientes y proveedores                                | no              | Gerente · Administrador · Empleado |
| `partes.crear`                            | Clientes y proveedores | Crear clientes y proveedores                              | no              | Gerente · Administrador · Empleado |
| `partes.editar`                           | Clientes y proveedores | Editar clientes y proveedores                             | no              | Gerente · Administrador · Empleado |
| `partes.cambiar_roles`                    | Clientes y proveedores | Cambiar si es cliente, proveedor o ambos                  | no              | Gerente · Administrador · Empleado |
| `partes.vincular_contacto`                | Clientes y proveedores | Vincular un contacto                                      | no              | Gerente · Administrador · Empleado |
| `partes.desvincular_contacto`             | Clientes y proveedores | Desvincular un contacto                                   | no              | Gerente · Administrador · Empleado |
| `partes.desactivar`                       | Clientes y proveedores | Desactivar clientes y proveedores                         | no              | Gerente · Administrador            |
| `partes.anonimizar`                       | Clientes y proveedores | Anonimizar los datos de un cliente o proveedor            | solo gerente    | Gerente                            |
| `partes.reactivar`                        | Clientes y proveedores | Reactivar clientes y proveedores                          | no              | Gerente · Administrador            |
| `proveedores.editar_ficha`                | Compras                | Editar la ficha de compras de un proveedor                | no              | Gerente · Administrador            |
| `proveedores.pedir_ficha`                 | Compras                | Pedir la ficha de compras a un proveedor                  | no              | Gerente · Administrador · Empleado |
| `recepciones.ver`                         | Compras                | Ver las recepciones de mercadería                         | no              | Gerente · Administrador · Empleado |
| `recepciones.registrar`                   | Compras                | Registrar una recepción de mercadería                     | no              | Gerente · Administrador · Empleado |
| `recepciones.anular`                      | Compras                | Anular una recepción                                      | no              | Gerente · Administrador            |
| `recepciones.confirmar`                   | Compras                | Confirmar una recepción                                   | no              | Gerente · Administrador            |
| `conciliaciones.ver`                      | Compras                | Ver las conciliaciones de compras                         | no              | Gerente · Administrador            |
| `conciliaciones.conciliar`                | Compras                | Conciliar una compra                                      | no              | Gerente · Administrador            |
| `conciliaciones.anular`                   | Compras                | Anular una conciliación                                   | no              | Gerente · Administrador            |
| `comprobantes_de_proveedor.ver`           | Compras                | Ver las facturas de proveedores                           | no              | Gerente · Administrador · Empleado |
| `comprobantes_de_proveedor.registrar`     | Compras                | Registrar una factura de proveedor                        | no              | Gerente · Administrador · Empleado |
| `comprobantes_de_proveedor.pagar`         | Compras                | Pagar una factura de proveedor                            | no              | Gerente · Administrador            |
| `comprobantes_de_proveedor.anular`        | Compras                | Anular una factura de proveedor                           | no              | Gerente · Administrador            |
| `comprobantes_de_proveedor.anular_pago`   | Compras                | Anular el pago de una factura de proveedor                | no              | Gerente · Administrador            |
| `comprobantes_de_proveedor.reemplazar`    | Compras                | Reemplazar una factura de proveedor                       | no              | Gerente · Administrador            |
| `ordenes_de_compra.ver`                   | Compras                | Ver las órdenes de compra                                 | no              | Gerente · Administrador · Empleado |
| `ordenes_de_compra.crear`                 | Compras                | Crear órdenes de compra                                   | no              | Gerente · Administrador            |
| `ordenes_de_compra.pedir`                 | Compras                | Enviar una orden de compra al proveedor                   | no              | Gerente · Administrador            |
| `ordenes_de_compra.cerrar`                | Compras                | Cerrar una orden de compra                                | no              | Gerente · Administrador            |
| `ordenes_de_compra.anular`                | Compras                | Anular una orden de compra                                | no              | Gerente · Administrador            |
| `devoluciones_a_proveedor.ver`            | Compras                | Ver las devoluciones a proveedores                        | no              | Gerente · Administrador · Empleado |
| `devoluciones_a_proveedor.registrar`      | Compras                | Registrar una devolución a un proveedor                   | no              | Gerente · Administrador            |
| `devoluciones_a_proveedor.anular`         | Compras                | Anular una devolución a un proveedor                      | no              | Gerente · Administrador            |
| `notas_de_credito_de_proveedor.ver`       | Compras                | Ver las notas de crédito de proveedores                   | no              | Gerente · Administrador · Empleado |
| `notas_de_debito_de_proveedor.ver`        | Compras                | Ver las notas de débito de proveedores                    | no              | Gerente · Administrador · Empleado |
| `notas_de_credito_de_proveedor.registrar` | Compras                | Registrar una nota de crédito de proveedor                | no              | Gerente · Administrador            |
| `notas_de_debito_de_proveedor.registrar`  | Compras                | Registrar una nota de débito de proveedor                 | no              | Gerente · Administrador            |
| `notas_de_credito_de_proveedor.anular`    | Compras                | Anular una nota de crédito de proveedor                   | no              | Gerente · Administrador            |
| `notas_de_debito_de_proveedor.anular`     | Compras                | Anular una nota de débito de proveedor                    | no              | Gerente · Administrador            |
| `diferencias_de_compra.ver`               | Compras                | Ver las diferencias de compra                             | no              | Gerente · Administrador            |
| `diferencias_de_compra.resolver`          | Compras                | Resolver una diferencia de compra                         | no              | Gerente · Administrador            |
| `compras.configurar`                      | Compras                | Configurar las compras                                    | solo gerente    | Gerente                            |
| `compras.corregir`                        | Compras                | Corregir una compra ya registrada                         | no              | Gerente · Administrador            |
| `compras.exportar`                        | Compras                | Exportar las compras a Excel                              | no              | Gerente · Administrador            |
| `cuenta_corriente.ver`                    | Cuenta corriente       | Ver las cuentas corrientes                                | no              | Gerente · Administrador            |
| `cuenta_corriente.administrar`            | Cuenta corriente       | Administrar las cuentas corrientes                        | no              | Gerente · Administrador            |
| `cuenta_corriente.cargar_a_cuenta`        | Cuenta corriente       | Cargar una venta a la cuenta corriente de un cliente      | no              | Gerente · Administrador · Empleado |
| `cuenta_corriente.aprobar_exceso`         | Cuenta corriente       | Aprobar que un cliente pase su límite de cuenta corriente | no              | Gerente · Administrador            |
| `cuenta_corriente.consultar_al_vender`    | Cuenta corriente       | Consultar la cuenta corriente al vender                   | no              | Gerente · Administrador · Empleado |
| `transformaciones.ver`                    | Producción             | Ver las transformaciones de producción                    | no              | Gerente · Administrador · Empleado |
| `transformaciones.abrir`                  | Producción             | Abrir una transformación                                  | no              | Gerente · Administrador · Empleado |
| `transformaciones.cerrar`                 | Producción             | Cerrar una transformación                                 | no              | Gerente · Administrador            |
| `transformaciones.cancelar`               | Producción             | Cancelar una transformación                               | no              | Gerente · Administrador            |
| `transformaciones.anular`                 | Producción             | Anular una transformación                                 | no              | Gerente · Administrador            |
