{
  description = "MedSearch — static site generator for Belgium's SAM v2 medication database";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        resourceLimit = cmd:
          "ionice -c 3 nice -n 15 prlimit --as=4000000000 -- ${cmd}";
      in
      {
        # Interactive dev shell with pinned tools
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [ bun pagefind curl unzip util-linux ];
          shellHook = ''
            echo "MedSearch build environment"
            echo ""
            echo "  nix build .#database   SAM XML → SQLite"
            echo "  nix build .#html       SQLite → HTML pages"
            echo "  nix build .#site       HTML → HTML + search index"
            echo "  nix build              Full pipeline"
            echo "  nix develop            This shell"
          '';
        };

        packages = {
          # Step 1: SAM XML → SQLite database
          # Requires: ./fetch-sam.sh run first (needs network)
          database = pkgs.stdenv.mkDerivation {
            name = "medsearch-database";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=$TMPDIR/medsearch.sqlite
              bun run scripts/sync-sam-database.ts --skip-download --verbose
            '';
            installPhase = "cp $TMPDIR/medsearch.sqlite $out";
          };

          # Step 2: SQLite → HTML pages
          html = pkgs.stdenv.mkDerivation {
            name = "medsearch-html";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=${self.packages.${system}.database}
              bun run generator/index.ts
            '';
            installPhase = "cp -r dist $out";
          };

          # Step 3: HTML → HTML + Pagefind search index
          site = pkgs.stdenv.mkDerivation {
            name = "medsearch-site";
            src = self.packages.${system}.html;
            nativeBuildInputs = with pkgs; [ pagefind util-linux ];
            buildPhase = ''
              cp -r $src site && chmod -R u+w site
              ${resourceLimit "pagefind --site site --output-subdir _search"}
            '';
            installPhase = "cp -r site $out";
          };

          # Full pipeline
          default = self.packages.${system}.site;
        };
      }
    );
}
