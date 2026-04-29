use anchor_lang::prelude::*;

declare_id!("HaqT9tUQjSGvb4QK9ZUtNRib9FPx9pcfpeCtih8oGuxb");

#[program]
pub mod crowdfund {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        title: String,
        goal_lamports: u64,
    ) -> Result<()> {
        require!(title.len() <= 64, CrowdfundError::TitleTooLong);
        require!(goal_lamports > 0, CrowdfundError::InvalidGoal);

        let campaign = &mut ctx.accounts.campaign;

        campaign.creator = ctx.accounts.creator.key();
        campaign.title = title;
        campaign.goal_lamports = goal_lamports;
        campaign.amount_raised = 0;
        campaign.withdrawn = false;
        campaign.bump = ctx.bumps.campaign;

        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(amount > 0, CrowdfundError::InvalidDonationAmount);

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.donor.key(),
            &ctx.accounts.campaign.key(),
            amount,
        );

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.donor.to_account_info(),
                ctx.accounts.campaign.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        ctx.accounts.campaign.amount_raised = ctx
            .accounts
            .campaign
            .amount_raised
            .checked_add(amount)
            .ok_or(CrowdfundError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        require!(!campaign.withdrawn, CrowdfundError::AlreadyWithdrawn);
        require!(
            campaign.amount_raised >= campaign.goal_lamports,
            CrowdfundError::GoalNotReached
        );

        let campaign_info = campaign.to_account_info();
        let recipient_info = ctx.accounts.creator.to_account_info();

        let rent_exempt_minimum = Rent::get()?.minimum_balance(campaign_info.data_len());
        let available_lamports = campaign_info
            .lamports()
            .checked_sub(rent_exempt_minimum)
            .ok_or(CrowdfundError::MathOverflow)?;

        **campaign_info.try_borrow_mut_lamports()? -= available_lamports;
        **recipient_info.try_borrow_mut_lamports()? += available_lamports;

        campaign.withdrawn = true;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [b"campaign", title.as_bytes(), creator.key().as_ref()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,

    #[account(mut,
        seeds = [b"campaign", campaign.title.as_bytes(), campaign.creator.key().as_ref()],
        bump = campaign.bump,)]
    pub campaign: Account<'info, Campaign>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", campaign.title.as_bytes(), creator.key().as_ref()],
        bump = campaign.bump,
        constraint = campaign.creator == creator.key()
    )]
    pub campaign: Account<'info, Campaign>,
}

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub creator: Pubkey,

    #[max_len(64)]
    pub title: String,

    pub goal_lamports: u64,
    pub amount_raised: u64,
    pub withdrawn: bool,
    pub bump: u8,
}

#[error_code]
pub enum CrowdfundError {
    #[msg("Title is too long")]
    TitleTooLong,

    #[msg("Goal must be greater than zero")]
    InvalidGoal,

    #[msg("Donation amount must be greater than zero")]
    InvalidDonationAmount,

    #[msg("Goal has not been reached")]
    GoalNotReached,

    #[msg("Campaign funds have already been withdrawn")]
    AlreadyWithdrawn,

    #[msg("Math overflow")]
    MathOverflow,
}
