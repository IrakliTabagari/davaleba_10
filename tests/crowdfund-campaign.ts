import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfund } from "../target/types/crowdfund";

import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { assert } from "chai";

describe("crowdfund vulnerable program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Crowdfund as Program<Crowdfund>;

  async function airdrop(pubkey: PublicKey, amount = 5 * LAMPORTS_PER_SOL) {
    const signature = await provider.connection.requestAirdrop(pubkey, amount);

    const latestBlockhash = await provider.connection.getLatestBlockhash();

    await provider.connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      "confirmed"
    );
  }

  it("happy path: creator creates campaign, donor funds it, creator withdraws", async () => {
    const creator = Keypair.generate();
    const donor = Keypair.generate();

    await airdrop(creator.publicKey);
    await airdrop(donor.publicKey);

    const title = "Build a Rust Bootcamp";
    const goalLamports = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const donationLamports = new anchor.BN(1 * LAMPORTS_PER_SOL);

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        Buffer.from(title),
        creator.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .createCampaign(title, goalLamports)
      .accounts({
        creator: creator.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    let campaign = await program.account.campaign.fetch(campaignPda);

    assert.equal(campaign.creator.toBase58(), creator.publicKey.toBase58());
    assert.equal(campaign.title, title);
    assert.equal(campaign.goalLamports.toString(), goalLamports.toString());
    assert.equal(campaign.amountRaised.toString(), "0");
    assert.equal(campaign.withdrawn, false);

    await program.methods
      .donate(donationLamports)
      .accounts({
        donor: donor.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    campaign = await program.account.campaign.fetch(campaignPda);

    assert.equal(campaign.amountRaised.toString(), donationLamports.toString());

    const creatorBalanceBefore = await provider.connection.getBalance(
      creator.publicKey
    );

    const campaignBalanceBefore = await provider.connection.getBalance(
      campaignPda
    );

    assert.isTrue(
      campaignBalanceBefore > 0,
      "Campaign should hold donated SOL plus rent"
    );

    await program.methods
      .withdraw()
      .accounts({
        creator: creator.publicKey,
        campaign: campaignPda,
      })
      .signers([creator])
      .rpc();

    campaign = await program.account.campaign.fetch(campaignPda);

    const creatorBalanceAfter = await provider.connection.getBalance(
      creator.publicKey
    );

    const campaignBalanceAfter = await provider.connection.getBalance(
      campaignPda
    );

    assert.equal(campaign.withdrawn, true);

    assert.isTrue(
      creatorBalanceAfter > creatorBalanceBefore,
      "Creator should receive withdrawn campaign funds"
    );

    assert.isTrue(
      campaignBalanceAfter < campaignBalanceBefore,
      "Campaign balance should decrease after withdrawal"
    );
  });

  it("anyone can donate to a campaign", async () => {
    const creator = Keypair.generate();
    const donor1 = Keypair.generate();
    const donor2 = Keypair.generate();

    await airdrop(creator.publicKey);
    await airdrop(donor1.publicKey);
    await airdrop(donor2.publicKey);

    const title = "Open Source Forever";
    const goalLamports = new anchor.BN(2 * LAMPORTS_PER_SOL);

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(title), creator.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createCampaign(title, goalLamports)
      .accounts({
        creator: creator.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const donation1 = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
    const donation2 = new anchor.BN(0.7 * LAMPORTS_PER_SOL);

    await program.methods
      .donate(donation1)
      .accounts({
        donor: donor1.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor1])
      .rpc();

    await program.methods
      .donate(donation2)
      .accounts({
        donor: donor2.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor2])
      .rpc();

    const campaign = await program.account.campaign.fetch(campaignPda);

    assert.equal(
      campaign.amountRaised.toString(),
      donation1.add(donation2).toString(),
      "amount_raised should equal the sum of all donations"
    );
  });

  it("only the creator can withdraw from a campaign", async () => {
    const creator = Keypair.generate();
    const donor = Keypair.generate();
    const attacker = Keypair.generate();

    await airdrop(creator.publicKey);
    await airdrop(donor.publicKey);
    await airdrop(attacker.publicKey);

    const title = "Creator-only Withdraw";
    const goalLamports = new anchor.BN(1 * LAMPORTS_PER_SOL);

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(title), creator.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createCampaign(title, goalLamports)
      .accounts({
        creator: creator.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .donate(goalLamports)
      .accounts({
        donor: donor.publicKey,
        campaign: campaignPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    let attackerWithdrawFailed = false;
    try {
      await program.methods
        .withdraw()
        .accounts({
          creator: attacker.publicKey,
          campaign: campaignPda,
        })
        .signers([attacker])
        .rpc();
    } catch (err) {
      attackerWithdrawFailed = true;
    }

    assert.isTrue(
      attackerWithdrawFailed,
      "non-creator should not be able to withdraw"
    );

    const creatorBalanceBefore = await provider.connection.getBalance(
      creator.publicKey
    );

    await program.methods
      .withdraw()
      .accounts({
        creator: creator.publicKey,
        campaign: campaignPda,
      })
      .signers([creator])
      .rpc();

    const creatorBalanceAfter = await provider.connection.getBalance(
      creator.publicKey
    );

    assert.isTrue(
      creatorBalanceAfter > creatorBalanceBefore,
      "creator should receive funds after a successful withdraw"
    );
  });
});
