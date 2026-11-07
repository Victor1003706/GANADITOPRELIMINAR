<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MapaInteractivo from '#lib/components/MapaInteractivo.svelte';

  type Department = { name: string; capital: string; center: [number, number] };
  type Listing = { id: string; title: string; category: string; department: string; quantity: string; price: number; image?: string; description: string };
  type Purchase = { id: string; title: string; department: string; price: number; status: number; created: string };
  const departments: Department[] = [
    {name:'Amazonas',capital:'Chachapoyas',center:[-6.23,-77.87]},{name:'Áncash',capital:'Huaraz',center:[-9.53,-77.53]},{name:'Apurímac',capital:'Abancay',center:[-13.64,-72.88]},{name:'Arequipa',capital:'Arequipa',center:[-16.4,-71.54]},{name:'Ayacucho',capital:'Ayacucho',center:[-13.16,-74.22]},{name:'Cajamarca',capital:'Cajamarca',center:[-7.16,-78.51]},{name:'Callao',capital:'Callao',center:[-12.06,-77.14]},{name:'Cusco',capital:'Cusco',center:[-13.52,-71.97]},{name:'Huancavelica',capital:'Huancavelica',center:[-12.79,-74.97]},{name:'Huánuco',capital:'Huánuco',center:[-9.93,-76.24]},{name:'Ica',capital:'Ica',center:[-14.07,-75.73]},{name:'Junín',capital:'Huancayo',center:[-12.07,-75.21]},{name:'La Libertad',capital:'Trujillo',center:[-8.11,-79.03]},{name:'Lambayeque',capital:'Chiclayo',center:[-6.77,-79.84]},{name:'Lima',capital:'Lima',center:[-12.05,-77.04]},{name:'Loreto',capital:'Iquitos',center:[-3.75,-73.25]},{name:'Madre de Dios',capital:'Puerto Maldonado',center:[-12.59,-69.19]},{name:'Moquegua',capital:'Moquegua',center:[-17.2,-70.93]},{name:'Pasco',capital:'Cerro de Pasco',center:[-10.68,-76.26]},{name:'Piura',capital:'Piura',center:[-5.19,-80.63]},{name:'Puno',capital:'Puno',center:[-15.84,-70.02]},{name:'San Martín',capital:'Moyobamba',center:[-6.03,-76.97]},{name:'Tacna',capital:'Tacna',center:[-18.01,-70.25]},{name:'Tumbes',capital:'Tumbes',center:[-3.57,-80.45]},{name:'Ucayali',capital:'Pucallpa',center:[-8.38,-74.53]}
  ];
  const sections = [
    {id:'inicio',label:'Inicio',icon:'⌂',help:'Explora la compra y venta de ganado, cortes y productos para la cadena ganadera.'},
    {id:'ganado',label:'Ganado',icon:'♧',help:'Filtra lotes por tipo de producto y revisa su precio estimado y departamento.'},
    {id:'subastas',label:'Subastas en vivo',icon:'⚒',help:'Participa en una subasta de prueba. Las ofertas no se envían al servidor.'},
    {id:'ubicacion',label:'Ubicación',icon:'⌖',help:'Elige un departamento para consultar una zona aproximada de los lotes.'},
    {id:'publicar',label:'Subir mi ganado',icon:'＋',help:'Completa el formulario y agrega fotos para ensayar una publicación local.'},
    {id:'compras',label:'Mis compras',icon:'▣',help:'Consulta compras de demostración y observa el avance simulado del traslado.'}
  ];
  const categories = ['Todos','Ganado en pie','Cortes de carne','Carne en canal','Ovinos y caprinos','Insumos y equipos'];
  const seedListings: Listing[] = [
    {id:'L-101',title:'Lote de vacunos para engorde',category:'Ganado en pie',department:'Cajamarca',quantity:'12 cabezas',price:18500,description:'Lote referencial de ganado vacuno; precio total estimado.'},
    {id:'L-102',title:'Novillos criollos',category:'Ganado en pie',department:'Junín',quantity:'8 cabezas',price:14400,description:'Ejemplo de lote para compra y coordinación de traslado.'},
    {id:'L-103',title:'Cortes de res por mayor',category:'Cortes de carne',department:'Lima',quantity:'120 kg',price:3240,description:'Precio de muestra para visualizar una oferta mayorista.'},
    {id:'L-104',title:'Carne de alpaca',category:'Cortes de carne',department:'Puno',quantity:'60 kg',price:2100,description:'Publicación de ejemplo para cortes y productos cárnicos.'},
    {id:'L-105',title:'Canal ovina',category:'Carne en canal',department:'Ayacucho',quantity:'18 canales',price:3960,description:'Oferta de demostración, pendiente de disponibilidad real.'},
    {id:'L-106',title:'Lote de 