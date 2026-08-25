-- Novo perfil operacional: vê e atualiza frota/manutenção, sem acesso a alugueres.
alter type user_role add value if not exists 'manutencao';
